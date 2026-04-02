import cv2, numpy as np, os, time, subprocess

print("Live Camera Detection — IMX219 + MobileNetSSD")
print(f"OpenCV: {cv2.__version__}")

MODEL_DIR = "/workspace/models"
PROTO   = os.path.join(MODEL_DIR, "MobileNetSSD_deploy.prototxt")
WEIGHTS = os.path.join(MODEL_DIR, "MobileNetSSD_deploy.caffemodel")
OUTPUT  = "/workspace/projects/camera_detection.jpg"

CLASSES = ["background","aeroplane","bicycle","bird","boat","bottle",
           "bus","car","cat","chair","cow","diningtable","dog","horse",
           "motorbike","person","pottedplant","sheep","sofa","train","tvmonitor"]

if not os.path.exists(PROTO) or not os.path.exists(WEIGHTS):
    print("ERROR: MobileNetSSD models not found in /workspace/models/")
    raise SystemExit(1)

RAW_TMP = "/tmp/cam_raw.bin"
WIDTH, HEIGHT = 3264, 2464
OUT_W, OUT_H  = 640, 480

print("\nCapturing frame from camera...")
r = subprocess.run([
    "v4l2-ctl", "--device=/dev/video0",
    f"--set-fmt-video=width={WIDTH},height={HEIGHT},pixelformat=RG10",
    "--stream-mmap", "--stream-count=1", f"--stream-to={RAW_TMP}"
], capture_output=True, timeout=15)

if r.returncode != 0 or not os.path.exists(RAW_TMP) or os.path.getsize(RAW_TMP) == 0:
    print("CSI capture failed — trying USB fallback...")
    cap = cv2.VideoCapture("/dev/video0")
    ret, frame = cap.read()
    cap.release()
    if not ret:
        print("ERROR: No camera available")
        raise SystemExit(1)
    print("USB frame captured")
else:
    raw = np.fromfile(RAW_TMP, dtype=np.uint16)
    os.remove(RAW_TMP)
    frame8 = cv2.normalize(
        raw[:WIDTH*HEIGHT].reshape(HEIGHT, WIDTH),
        None, 0, 255, cv2.NORM_MINMAX
    ).astype(np.uint8)
    bgr = cv2.cvtColor(frame8, cv2.COLOR_BayerBG2BGR_EA)
    h, w = bgr.shape[:2]
    zone = bgr[h//4:h//2, w//3:2*w//3]
    ref  = float(zone[:,:,1].mean())
    b, g, rc = cv2.split(bgr.astype(np.float32))
    b  = np.clip(b  * (ref / (float(zone[:,:,0].mean()) + 1e-6)), 0, 255)
    rc = np.clip(rc * (ref / (float(zone[:,:,2].mean()) + 1e-6)), 0, 255)
    res = cv2.merge([b, g, rc]).astype(np.uint8)
    lab = cv2.cvtColor(res, cv2.COLOR_BGR2LAB)
    lab[:,:,0] = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8,8)).apply(lab[:,:,0])
    res   = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    frame = cv2.resize(res, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)
    print(f"CSI frame: {frame.shape}")

print("Loading MobileNetSSD...")
net  = cv2.dnn.readNetFromCaffe(PROTO, WEIGHTS)
blob = cv2.dnn.blobFromImage(cv2.resize(frame,(300,300)),0.007843,(300,300),127.5)
net.setInput(blob)

t0  = time.time()
det = net.forward()
inf_ms = (time.time() - t0) * 1000
print(f"Inference: {inf_ms:.1f}ms")

h, w = frame.shape[:2]
found = []
for i in range(det.shape[2]):
    conf = float(det[0, 0, i, 2])
    if conf > 0.25:
        cid   = int(det[0, 0, i, 1])
        label = CLASSES[cid] if cid < len(CLASSES) else "unknown"
        box   = (det[0, 0, i, 3:7] * np.array([w, h, w, h])).astype(int)
        x1, y1, x2, y2 = box
        cv2.rectangle(frame, (x1,y1), (x2,y2), (0,220,0), 2)
        cv2.putText(frame, f"{label} {conf*100:.0f}%",
                    (x1, max(y1-6,12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,220,0), 1)
        found.append(f"{label} ({conf*100:.1f}%)")
        print(f"  {label}: {conf*100:.1f}%")

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
cv2.imwrite(OUTPUT, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
print(f"\nSaved: {OUTPUT} ({os.path.getsize(OUTPUT)//1024} KB)")
print(f"Detections: {len(found)}")
for d in found:
    print(f"  -> {d}")
print("Camera detection complete")
