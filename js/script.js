import { detectGlassesAPI } from "./api.js";

class FaceCaptureApp {
  constructor() {
    this.video = document.getElementById("videoElement");
    this.captureCanvas = document.getElementById("captureCanvas");
    this.captureCtx = this.captureCanvas.getContext("2d");
    this.overlayCanvas = document.getElementById("overlayCanvas");
    this.overlayCtx = this.overlayCanvas.getContext("2d");

    this.stream = null;
    this.isCapturing = false;
    this.detectionInterval = null;
    this.alignmentCounter = 0;
    this.requiredAlignmentFrames = 15;
    this.captureDelayMs = 3000;
    this.previousFrame = null;
    this.motionThreshold = 30;

    this.capturedPhoto = null;
    this.landmarks = null;
    this.faceMesh = null;

    this.measurements = {
      pdTotal: 0,
      pdLeft: 0,
      pdRight: 0,
      leftNose: 0,
      rightNose: 0,
      noseTotal: 0,
      fittingHeight: 0,
      faceWidth: 0,
      faceHeight: 0,
      faceRatio: 0,
      pixelsPerMM: 0,
    };

    this.frameAdjustments = { vertical: 0, size: 100, rotation: 0 };
    this.selectedFrameIndex = 0;

    this.frames = [
      { id: "frame1", name: "Frame 1", src: "frame1.png", widthMM: 124, heightMM: 41 },
      { id: "frame2", name: "Frame 2", src: "frame2.png", widthMM: 120, heightMM: 39 },
      { id: "frame3", name: "Frame 3", src: "frame3.png", widthMM: 118, heightMM: 42 },
    ];

    this.frameImages = {};
    this.loadFrameImages();
    this.setupEventListeners();

    // Cal / device table: add devices you know for better px/mm defaults
    this.devicePxMmTable = {
      // example: 'Pixel 7': 0.264, means px_per_mm or mm per px? we'll store px_per_mm
      // add real device mappings if you have them: 'iPhone 12': 3.2 (px per mm at expected distance)
      // Leave empty if you prefer calibration
    };

    // initialize calibration UI
    this.initCalibrationUI();
  }

  loadFrameImages() {
    this.frames.forEach((frame) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.frameImages[frame.id] = img;
        console.log(`Loaded ${frame.name}`);
      };
      img.onerror = () => {
        console.error(`Failed to load ${frame.src}`);
      };
      img.src = frame.src;
    });
  }

  setupEventListeners() {
    document.getElementById("verticalSlider").addEventListener("input", (e) => {
      this.frameAdjustments.vertical = parseInt(e.target.value);
      document.getElementById("verticalValue").textContent = e.target.value;
      this.updateOverlay();
      this.updateDynamicMeasurements();
    });

    document.getElementById("sizeSlider").addEventListener("input", (e) => {
      this.frameAdjustments.size = parseInt(e.target.value);
      document.getElementById("sizeValue").textContent = e.target.value + "%";
      this.updateOverlay();
      this.recalculateAllMeasurements();
    });

    document.getElementById("rotationSlider").addEventListener("input", (e) => {
      this.frameAdjustments.rotation = parseFloat(e.target.value);
      document.getElementById("rotationValue").textContent = e.target.value + "°";
      this.updateOverlay();
    });
  }

  // --- Camera start & detection ---
  async startCamera() {
    try {
      document.getElementById("errorMessage").style.display = "none";
      document.getElementById("startBtn").style.display = "none";

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });

      this.video.srcObject = this.stream;

      this.video.onloadedmetadata = () => {
        this.captureCanvas.width = this.video.videoWidth;
        this.captureCanvas.height = this.video.videoHeight;

        // set overlay canvas same size so captured photo draws correctly
        this.overlayCanvas.width = this.video.videoWidth;
        this.overlayCanvas.height = this.video.videoHeight;

        this.updateStatus("📍 Position your face in the oval", "misaligned");
        document.getElementById("faceGuide").classList.add("detecting");

        setTimeout(() => { this.startDetection(); }, 1000);
      };
    } catch (err) {
      console.error("Camera error:", err);
      this.showError("Camera access denied. Please allow camera permissions and try again.");
    }
  }

  startDetection() {
    if (this.detectionInterval) clearInterval(this.detectionInterval);

    this.detectionInterval = setInterval(() => {
      if (!this.isCapturing && this.video.readyState === 4) {
        this.checkFaceAlignment();
      }
    }, 100);
  }

  checkFaceAlignment() {
    this.captureCtx.drawImage(this.video, 0, 0, this.captureCanvas.width, this.captureCanvas.height);
    const imageData = this.captureCtx.getImageData(0, 0, this.captureCanvas.width, this.captureCanvas.height);
    const data = imageData.data;
    const result = this.analyzeFrame(data, this.captureCanvas.width, this.captureCanvas.height);

    if (result.isAligned && !result.hasMotion) {
      // ---------------- GLASSES CHECK (runs every 1.2 sec) ----------------
const now = Date.now();
if (now - this.lastGlassesCheck > 1200) {
    this.lastGlassesCheck = now;

    const base64Image = this.captureCanvas.toDataURL("image/png");

    detectGlassesAPI(base64Image).then((response) => {
        if (response?.glasses === true) {
            this.updateStatus("👓 Please remove your glasses", "misaligned");
            this.alignmentCounter = 0;
            return; // stop alignment so countdown never starts
        }
    }).catch((err) => {
        console.error("Glasses detection error:", err);
    });
}
      this.alignmentCounter++;

      if (this.alignmentCounter === 5) {
        this.updateStatus("✅ Good! Keep your position...", "aligned");
        document.getElementById("faceGuide").classList.add("aligned");
        document.getElementById("faceGuide").classList.remove("detecting");
      }

      if (this.alignmentCounter >= this.requiredAlignmentFrames) {
        this.beginCapture();
      } else if (this.alignmentCounter > 5) {
        const progress = Math.floor((this.alignmentCounter / this.requiredAlignmentFrames) * 100);
        this.updateStatus(`✅ Perfect! Detecting... ${progress}%`, "aligned");
      }
    } else {
      if (this.alignmentCounter > 0) {
        this.alignmentCounter = 0;
        document.getElementById("faceGuide").classList.remove("aligned");
        document.getElementById("faceGuide").classList.add("detecting");
      }

      if (result.hasMotion) {
        this.updateStatus("⚠️ Too much movement - Stay still", "misaligned");
      } else {
        this.updateStatus(result.message, "misaligned");
      }
    }

    this.previousFrame = data.slice();
  }

  analyzeFrame(data, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const ovalWidth = Math.min(300, width * 0.45);
    const ovalHeight = Math.min(350, height * 0.6);

    let brightnessSum = 0;
    let pixelCount = 0;
    let centerWeightSum = 0;

    /* -------------------------
       FIXED MOTION DETECTION
    --------------------------*/
    let motionLevel = 0;
    if (this.previousFrame) {
        let diffSum = 0;
        for (let i = 0; i < data.length; i += 4) {
            const dr = Math.abs(data[i] - this.previousFrame[i]);
            const dg = Math.abs(data[i+1] - this.previousFrame[i+1]);
            const db = Math.abs(data[i+2] - this.previousFrame[i+2]);
            diffSum += dr + dg + db;
        }

        const totalChannels = width * height * 3;
        motionLevel = diffSum / totalChannels;

        if (!this.motionSmoothed) this.motionSmoothed = motionLevel;
        this.motionSmoothed = (this.motionSmoothed * 0.8) + (motionLevel * 0.2);
        motionLevel = this.motionSmoothed;
    }

    this.previousFrame = new Uint8ClampedArray(data);

    /* -------------------------
       BRIGHTNESS CHECK
    --------------------------*/
    for (let y = Math.max(0, centerY - ovalHeight/2); y < Math.min(height, centerY + ovalHeight/2); y += 5) {
        for (let x = Math.max(0, centerX - ovalWidth/2); x < Math.min(width, centerX + ovalWidth/2); x += 5) {

            const dx = (x - centerX) / (ovalWidth / 2);
            const dy = (y - centerY) / (ovalHeight / 2);
            if (dx*dx + dy*dy <= 1) {

                const idx = (y * width + x) * 4;
                const r = data[idx], g = data[idx+1], b = data[idx+2];
                const brightness = (r + g + b) / 3;

                brightnessSum += brightness;

                const distFromCenter = Math.sqrt(dx*dx + dy*dy);
                centerWeightSum += (1 - distFromCenter) * brightness;

                pixelCount++;
            }
        }
    }

    if (pixelCount === 0) {
        return { isAligned: false, distanceOK: false, message: "❌ No face detected", distanceCM: null };
    }

    const avgBrightness = brightnessSum / pixelCount;
    const centerWeight = centerWeightSum / pixelCount;

    /* -------------------------
       MOVEMENT THRESHOLDS
    --------------------------*/
    const MIN_MOTION_THRESHOLD = 5;
    const MAX_MOTION_ALLOWED = 20;

    if (motionLevel > MAX_MOTION_ALLOWED) {
        return { isAligned: false, distanceOK: false, message: "⚠️ Too much movement", distanceCM: null };
    }

    /* -------------------------
       BRIGHTNESS RULES
    --------------------------*/
    if (avgBrightness < 50) return { isAligned: false, distanceOK: false, message: "💡 Too dark", distanceCM: null };
    if (avgBrightness > 240) return { isAligned: false, distanceOK: false, message: "☀️ Too bright", distanceCM: null };
    if (centerWeight < 40) return { isAligned: false, distanceOK: false, message: "🎯 Center your face", distanceCM: null };

    /* ==========================================================
       ⭐ ⭐ 45 CM DISTANCE CHECK USING PD-BASED ESTIMATION ⭐ ⭐
       ==========================================================*/
    let distanceCM = null;
    let distanceOK = false;

    if (this.currentLandmarks) {
        // PD landmark indices from Mediapipe
        const LEFT = this.currentLandmarks[33];
        const RIGHT = this.currentLandmarks[263];

        if (LEFT && RIGHT) {
            const dx = RIGHT.x - LEFT.x;
            const dy = RIGHT.y - LEFT.y;
            const eyeDistPx = Math.sqrt(dx*dx + dy*dy);

            const REAL_PD_MM = 63; // avg PD

            if (this.measurements?.pixelsPerMM) {
                // calibrated
                const eyeMM = eyeDistPx / this.measurements.pixelsPerMM;
                const scale = eyeMM / REAL_PD_MM;
                distanceCM = 45 / scale;
            } else {
                // fallback
                const mmPerPixel = REAL_PD_MM / eyeDistPx;
                distanceCM = (eyeDistPx * mmPerPixel) / 10;
            }

            // Check distance tolerance 43–47 cm
            if (distanceCM > 43 && distanceCM < 47) {
                distanceOK = true;
            }
        }
    }

    return {
        isAligned: true,
        distanceOK,
        distanceCM,
        message: distanceOK
            ? `🟢 Perfect distance (${distanceCM.toFixed(1)} cm)`
            : distanceCM
                ? `📏 Distance: ${distanceCM.toFixed(1)} cm — adjust`
                : "✅ Perfect alignment!"
    };
}




  beginCapture() {
    if (this.isCapturing) return;

    this.isCapturing = true;
    this.alignmentCounter = 0;
    if (this.detectionInterval) clearInterval(this.detectionInterval);

    let countdown = 3;
    const countdownElement = document.getElementById("countdown");

    this.updateStatus("📸 Get ready for capture!", "capturing");

    const countdownInterval = setInterval(() => {
      if (countdown > 0) {
        countdownElement.style.display = "block";
        countdownElement.textContent = countdown;
        countdownElement.style.animation = "none";
        setTimeout(() => { countdownElement.style.animation = "countdownPulse 1s ease"; }, 10);
        countdown--;
      } else {
        clearInterval(countdownInterval);
        countdownElement.style.display = "none";
        this.startCaptureWithProgress();
      }
    }, 1000);
  }

  startCaptureWithProgress() {
    const progressContainer = document.getElementById("progressContainer");
    const progressFill = document.getElementById("progressFill");
    const progressText = document.getElementById("progressText");

    progressContainer.classList.add("active");
    this.updateStatus("📸 Capturing... Hold perfectly still!", "capturing");

    let progress = 0;
    const increment = 100 / (this.captureDelayMs / 50);

    const progressInterval = setInterval(() => {
      progress += increment;

      if (progress >= 100) {
        progress = 100;
        clearInterval(progressInterval);

        setTimeout(() => {
          this.captureImage();
          progressContainer.classList.remove("active");
          progressFill.style.width = "0%";
        }, 200);
      }

      progressFill.style.width = progress + "%";

      if (progress < 30) progressText.textContent = "Analyzing face position...";
      else if (progress < 60) progressText.textContent = "Detecting facial features...";
      else if (progress < 90) progressText.textContent = "Finalizing capture...";
      else progressText.textContent = "Almost done!";
    }, 50);
  }

  async captureImage() {
    this.captureCtx.drawImage(this.video, 0, 0, this.captureCanvas.width, this.captureCanvas.height);
    this.capturedPhoto = this.captureCanvas.toDataURL("image/png");

    await this.initializeFaceMesh();

    this.isCapturing = false;
    document.getElementById("faceGuide").classList.remove("aligned", "detecting");
  }

  async initializeFaceMesh() {
    this.updateStatus("🔍 Detecting facial features...", "capturing");

    // Use MediaPipe FaceMesh (already included in your HTML)
    this.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    this.faceMesh.onResults((results) => this.processFaceMeshResults(results));

    const img = new Image();
    img.onload = async () => {
      await this.faceMesh.send({ image: img });
    };
    img.src = this.capturedPhoto;
  }

  processFaceMeshResults(results) {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      this.landmarks = results.multiFaceLandmarks[0];

      // compute measurements immediately
      this.calculatePreciseMeasurements();

      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
      }

      this.showTryOnStep();
    } else {
      this.showError("Could not detect facial features. Please retake the photo.");
      setTimeout(() => this.retake(), 2000);
    }
  }

  // --- PIXELS <-> MM support ---
  // default known object width (credit card)
  static get DEFAULT_CARD_MM() { return 85.6; }

  // read pixelsPerMM from sessionStorage or device table or return fallback
  getPixelsPerMM() {
    // 1) session-stored calibration (highest priority)
    const stored = sessionStorage.getItem("pixelsPerMM");
    if (stored) {
      return { pixelsPerMM: parseFloat(stored), confidence: "high" };
    }

    // 2) simple device mapping (optional, low-medium confidence)
    const ua = navigator.userAgent || "";
    for (const key in this.devicePxMmTable) {
      if (ua.indexOf(key) !== -1) {
        return { pixelsPerMM: this.devicePxMmTable[key], confidence: "medium" };
      }
    }

    // 3) fallback: estimate from average adult face width (low confidence)
    // Keep the fallback to preserve current behavior, but mark low-confidence
    // We will compute faceWidthPx below and derive pixelsPerMM using estimated width
    return { pixelsPerMM: null, confidence: "low" };
  }

  // compute pixelsPerMM from drawn line length (px) and known mm length (default card)
  computePixelsPerMMFromLine(pxLength, knownMM = FaceCaptureApp.DEFAULT_CARD_MM) {
    if (!pxLength || pxLength <= 0) return null;
    const pxPerMM = pxLength / knownMM;
    sessionStorage.setItem("pixelsPerMM", pxPerMM.toString());
    this.measurements.pixelsPerMM = pxPerMM;
    return pxPerMM;
  }

  // --- Calibration UI injection (draw a line over the captured photo) ---
  initCalibrationUI() {
  // Insert calibrate button
  const calibrateBtn = document.createElement("button");
  calibrateBtn.textContent = "Calibrate (Card)";
  calibrateBtn.className = "calibrate-btn";
  calibrateBtn.onclick = () => {
    if (!this.capturedPhoto) return alert("Take a photo first.");
    this.startCalibration();
  };

  // Guaranteed insertion point
  const target = document.getElementById("frameAdjustmentControls")
      || document.querySelector(".controls")
      || document.body;
  target.appendChild(calibrateBtn);

  // Create calibration canvas
  this.calCanvas = document.createElement("canvas");
  this.calCanvas.id = "calCanvas";
  this.calCanvas.style.position = "absolute";
  this.calCanvas.style.zIndex = 50;
  this.calCanvas.style.display = "none";

  // Insert near overlayCanvas ALWAYS
  this.overlayCanvas.parentNode.appendChild(this.calCanvas);

  this.calCtx = this.calCanvas.getContext("2d");

  this.calStart = null;
  this.calEnd = null;
  
  this.calCanvas.addEventListener("pointerdown", e => this._calOnPointerDown(e));
  this.calCanvas.addEventListener("pointermove", e => this._calOnPointerMove(e));
  this.calCanvas.addEventListener("pointerup", e => this._calOnPointerUp(e));
  this.calCanvas.addEventListener("pointerleave", e => this._calOnPointerUp(e));
}

  startCalibration() {
    // show calibration canvas over overlayCanvas with same size
    const img = new Image();
    img.onload = () => {
      // set calCanvas same size & position as overlayCanvas
      this.calCanvas.width = this.overlayCanvas.width;
      this.calCanvas.height = this.overlayCanvas.height;
      this.calCanvas.style.display = "block";
      // draw captured photo to cal canvas as background to guide user
      this.calCtx.clearRect(0, 0, this.calCanvas.width, this.calCanvas.height);
      this.calCtx.globalAlpha = 1.0;
      this.calCtx.drawImage(img, 0, 0, this.calCanvas.width, this.calCanvas.height);

      // instruction overlay
      this.calCtx.fillStyle = "rgba(0,0,0,0.45)";
      this.calCtx.fillRect(0, 0, this.calCanvas.width, 50);
      this.calCtx.fillStyle = "#fff";
      this.calCtx.font = "16px Arial";
      this.calCtx.fillText("Draw a line over a known-width object (credit card ~85.6 mm). Release to confirm.", 10, 32);
    };
    img.src = this.capturedPhoto;
  }

  _calOnPointerDown(e) {
    const r = this.calCanvas.getBoundingClientRect();
    this.calStart = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.calEnd = null;
  }

  _calOnPointerMove(e) {
    if (!this.calStart) return;
    const r = this.calCanvas.getBoundingClientRect();
    this.calEnd = { x: e.clientX - r.left, y: e.clientY - r.top };
    // redraw
    this.calCtx.clearRect(0, 0, this.calCanvas.width, this.calCanvas.height);
    // background photo
    const bg = new Image();
    bg.onload = () => {
      this.calCtx.drawImage(bg, 0, 0, this.calCanvas.width, this.calCanvas.height);
      // instruction header
      this.calCtx.fillStyle = "rgba(0,0,0,0.45)";
      this.calCtx.fillRect(0, 0, this.calCanvas.width, 50);
      this.calCtx.fillStyle = "#fff";
      this.calCtx.font = "16px Arial";
      this.calCtx.fillText("Draw a line over a known-width object (credit card ~85.6 mm). Release to confirm.", 10, 32);

      if (this.calStart && this.calEnd) {
        this.calCtx.strokeStyle = "#00ffcc";
        this.calCtx.lineWidth = 4;
        this.calCtx.beginPath();
        this.calCtx.moveTo(this.calStart.x, this.calStart.y);
        this.calCtx.lineTo(this.calEnd.x, this.calEnd.y);
        this.calCtx.stroke();

        // draw endpoints
        this.calCtx.fillStyle = "#00ffcc";
        this.calCtx.beginPath();
        this.calCtx.arc(this.calStart.x, this.calStart.y, 6, 0, Math.PI*2);
        this.calCtx.fill();
        this.calCtx.beginPath();
        this.calCtx.arc(this.calEnd.x, this.calEnd.y, 6, 0, Math.PI*2);
        this.calCtx.fill();
      }
    };
    bg.src = this.capturedPhoto;
  }

  _calOnPointerUp(e) {
    if (!this.calStart || !this.calEnd) {
      // hide and reset
      this.calCanvas.style.display = "none";
      this.calStart = this.calEnd = null;
      return;
    }
    // compute pixel length from drawn line
    const dx = this.calEnd.x - this.calStart.x;
    const dy = this.calEnd.y - this.calStart.y;
    const pxLength = Math.sqrt(dx*dx + dy*dy);
    // compute px/mm and save
    const pxPerMM = this.computePixelsPerMMFromLine(pxLength, FaceCaptureApp.DEFAULT_CARD_MM);
    this.calCanvas.style.display = "none";
    this.calStart = this.calEnd = null;

    if (pxPerMM) {
      this.showToast(`Calibration saved: ${pxPerMM.toFixed(3)} px/mm (high confidence)`);
      // recalc measurements now that we have px/mm
      this.recalculateAllMeasurements();
    } else {
      this.showError("Calibration failed. Try again.");
    }
  }

  showToast(msg) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 16px;border-radius:10px;z-index:99999;";
    document.body.appendChild(el);
    setTimeout(()=> el.remove(), 3500);
  }

  // --- MEASUREMENTS ---
  calculatePreciseMeasurements() {
    if (!this.landmarks) return;

    // convert normalized landmarks to pixels using captureCanvas (captured image size)
    const imgW = this.captureCanvas.width;
    const imgH = this.captureCanvas.height;

    // Eye centers (average of 4 eye landmarks each)
    const leftEyeOuter = this.landmarks[33];
    const leftEyeInner = this.landmarks[133];
    const leftEyeTop = this.landmarks[159];
    const leftEyeBottom = this.landmarks[145];

    const rightEyeOuter = this.landmarks[263];
    const rightEyeInner = this.landmarks[362];
    const rightEyeTop = this.landmarks[386];
    const rightEyeBottom = this.landmarks[374];

    const leftEyeCenter = {
      x: (leftEyeOuter.x + leftEyeInner.x + leftEyeTop.x + leftEyeBottom.x) / 4,
      y: (leftEyeOuter.y + leftEyeInner.y + leftEyeTop.y + leftEyeBottom.y) / 4
    };
    const rightEyeCenter = {
      x: (rightEyeOuter.x + rightEyeInner.x + rightEyeTop.x + rightEyeBottom.x) / 4,
      y: (rightEyeOuter.y + rightEyeInner.y + rightEyeTop.y + rightEyeBottom.y) / 4
    };

    const noseCenter = this.landmarks[1];
    const leftCheek = this.landmarks[234];
    const rightCheek = this.landmarks[454];
    const foreheadTop = this.landmarks[10];
    const chinBottom = this.landmarks[152];

    // pixel coords
    const xL = leftEyeCenter.x * imgW, yL = leftEyeCenter.y * imgH;
    const xR = rightEyeCenter.x * imgW, yR = rightEyeCenter.y * imgH;
    const xN = noseCenter.x * imgW, yN = noseCenter.y * imgH;
    const xLeftCheek = leftCheek.x * imgW, xRightCheek = rightCheek.x * imgW;
    const yForehead = foreheadTop.y * imgH, yChin = chinBottom.y * imgH;

    // pixel distances
    const pdTotalPx = Math.abs(xR - xL);
    const centerX = (xL + xR) / 2;
    const pdLeftPx = Math.abs(centerX - xL);
    const pdRightPx = Math.abs(xR - centerX);
    const leftNosePx = Math.abs(xN - xL);
    const rightNosePx = Math.abs(xR - xN);
    const noseTotalPx = leftNosePx + rightNosePx;
    const faceWidthPx = Math.abs(xRightCheek - xLeftCheek);
    const faceHeightPx = Math.abs(yChin - yForehead);

    // determine px/mm
    const pxMmInfo = this.getPixelsPerMM();
    let pixelsPerMM = pxMmInfo.pixelsPerMM;
    let confidence = pxMmInfo.confidence;

    if (!pixelsPerMM) {
      // derive from estimated face width assumption (low confidence)
      const estimatedFaceWidthMM = 140; // default average
      pixelsPerMM = faceWidthPx / estimatedFaceWidthMM;
      confidence = "low";
    }

    // set in state
    this.measurements.pdTotal = pdTotalPx / pixelsPerMM;
    this.measurements.pdLeft = pdLeftPx / pixelsPerMM;
    this.measurements.pdRight = pdRightPx / pixelsPerMM;
    this.measurements.leftNose = leftNosePx / pixelsPerMM;
    this.measurements.rightNose = rightNosePx / pixelsPerMM;
    this.measurements.noseTotal = noseTotalPx / pixelsPerMM;
    this.measurements.faceWidth = faceWidthPx / pixelsPerMM;
    this.measurements.faceHeight = faceHeightPx / pixelsPerMM;
    this.measurements.pixelsPerMM = pixelsPerMM;

    // fitting height calculation using selected frame physical mm
    const eyeCenterY = (yL + yR) / 2;
    const selectedFrame = this.frames[this.selectedFrameIndex];
    const frameImg = this.frameImages[selectedFrame.id];

    if (frameImg) {
      const actualFrameHeightMM = selectedFrame.heightMM * (this.frameAdjustments.size / 100);
      const frameHeightPx = actualFrameHeightMM * pixelsPerMM;
      const frameBottomY = eyeCenterY + frameHeightPx / 2 + this.frameAdjustments.vertical;
      const fittingHeightPx = Math.abs(frameBottomY - eyeCenterY);
      this.measurements.fittingHeight = fittingHeightPx / pixelsPerMM;
    } else {
      this.measurements.fittingHeight = 0;
    }

    this.measurements.faceRatio = this.measurements.faceWidth / this.measurements.faceHeight;
    const faceShape = this.classifyFaceShape(this.measurements.faceRatio);

    // pass confidence to display so user knows how reliable the mm values are
    this.displayMeasurements(faceShape, confidence);
  }

  classifyFaceShape(ratio) {
    // tuned thresholds (you can tweak)
    if (ratio >= 0.95 && ratio <= 1.05) return "Square";
    if (ratio >= 0.85 && ratio < 0.95) return "Round";
    if (ratio >= 0.75 && ratio < 0.85) return "Oval";
    if (ratio < 0.75) return "Long/Oblong";
    return "Heart/Diamond";
  }

  displayMeasurements(faceShape, confidence = "low") {
    const cfBadge = confidence === "high" ? "🔒 high" : confidence === "medium" ? "⚠️ medium" : "⚠️ low";
    document.getElementById("pdTotalMeasurement").textContent = this.measurements.pdTotal.toFixed(1) + " mm";
    document.getElementById("pdLeftMeasurement").textContent = this.measurements.pdLeft.toFixed(1) + " mm";
    document.getElementById("pdRightMeasurement").textContent = this.measurements.pdRight.toFixed(1) + " mm";
    document.getElementById("leftNoseMeasurement").textContent = this.measurements.leftNose.toFixed(1) + " mm";
    document.getElementById("rightNoseMeasurement").textContent = this.measurements.rightNose.toFixed(1) + " mm";
    document.getElementById("totalNoseMeasurement").textContent = this.measurements.noseTotal.toFixed(1) + " mm";
    document.getElementById("fittingHeightMeasurement").textContent = this.measurements.fittingHeight.toFixed(1) + " mm";
    document.getElementById("faceWidthMeasurement").textContent = this.measurements.faceWidth.toFixed(1) + " mm";
    document.getElementById("faceHeightMeasurement").textContent = this.measurements.faceHeight.toFixed(1) + " mm";
    document.getElementById("faceRatioMeasurement").textContent = this.measurements.faceRatio.toFixed(2) + ` (${cfBadge})`;
    document.getElementById("faceShapeMeasurement").textContent = faceShape;
  }

  updateDynamicMeasurements() {
    if (!this.landmarks) return;
    // same logic as recalc but only fitting height changes when user moves slider
    // call recalculateAllMeasurements for a full recalculation
    this.recalculateAllMeasurements();
  }

  recalculateAllMeasurements() {
    if (!this.landmarks) return;
    this.calculatePreciseMeasurements();
  }

  showTryOnStep() {
    document.getElementById("step1").classList.remove("active");
    document.getElementById("step2").classList.add("active");

    this.renderFrameSelector();

    const img = new Image();
    img.onload = () => {
      this.overlayCanvas.width = img.width;
      this.overlayCanvas.height = img.height;
      this.overlayCanvas.style.display = "block";
      // draw initial
      this.updateOverlay();
    };
    img.src = this.capturedPhoto;
  }

  renderFrameSelector() {
    const selector = document.getElementById("frameSelector");
    selector.innerHTML = "";

    this.frames.forEach((frame, idx) => {
      const div = document.createElement("div");
      div.className = "frame-option" + (idx === 0 ? " selected" : "");
      const img = this.frameImages[frame.id];
      if (img) {
        div.innerHTML = `<div class="frame-preview"><img src="${frame.src}" style="max-width: 100%; max-height: 100%; object-fit: contain;" /></div><div>${frame.name}</div>`;
      } else {
        div.innerHTML = `<div class="frame-preview">Loading...</div><div>${frame.name}</div>`;
      }
      div.addEventListener("click", () => {
        document.querySelectorAll(".frame-option").forEach((o) => o.classList.remove("selected"));
        div.classList.add("selected");
        this.selectedFrameIndex = idx;
        this.updateOverlay();
        this.recalculateAllMeasurements();
      });
      selector.appendChild(div);
    });
  }

  updateOverlay() {
    if (!this.capturedPhoto || !this.landmarks) return;

    const ctx = this.overlayCtx;
    const img = new Image();

    img.onload = () => {
      ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      ctx.drawImage(img, 0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

      const selectedFrame = this.frames[this.selectedFrameIndex];
      const frameImg = this.frameImages[selectedFrame.id];
      if (!frameImg) return;

      // eye center calculation using normalized landmarks relative to captureCanvas
      const imgW = this.captureCanvas.width, imgH = this.captureCanvas.height;
      const leftEyeOuter = this.landmarks[33];
      const leftEyeInner = this.landmarks[133];
      const leftEyeTop = this.landmarks[159];
      const leftEyeBottom = this.landmarks[145];

      const rightEyeOuter = this.landmarks[263];
      const rightEyeInner = this.landmarks[362];
      const rightEyeTop = this.landmarks[386];
      const rightEyeBottom = this.landmarks[374];

      const leftEyeCenter = {
        x: (leftEyeOuter.x + leftEyeInner.x + leftEyeTop.x + leftEyeBottom.x) / 4,
        y: (leftEyeOuter.y + leftEyeInner.y + leftEyeTop.y + leftEyeBottom.y) / 4
      };
      const rightEyeCenter = {
        x: (rightEyeOuter.x + rightEyeInner.x + rightEyeTop.x + rightEyeBottom.x) / 4,
        y: (rightEyeOuter.y + rightEyeInner.y + rightEyeTop.y + rightEyeBottom.y) / 4
      };

      const leftX = leftEyeCenter.x * imgW, leftY = leftEyeCenter.y * imgH;
      const rightX = rightEyeCenter.x * imgW, rightY = rightEyeCenter.y * imgH;

      const eyeDistance = Math.abs(rightX - leftX);
      const eyeCenterX = (leftX + rightX) / 2;
      const eyeCenterY = (leftY + rightY) / 2;

      // frame sizing visually: use eyeDistance and the physical frame width if px/mm available
      const pxMmInfo = this.getPixelsPerMM();
      let pixelsPerMM = pxMmInfo.pixelsPerMM;
      if (!pixelsPerMM) {
        // fallback: use eyeDistance-derived heuristic for visual only
        pixelsPerMM = eyeDistance / 63; // assume average PD ~63 mm — visual heuristic
      }

      // prefer physical frame sizing if px/mm known
      if (pxMmInfo.confidence === "high" || pxMmInfo.confidence === "medium") {
        const selected = this.frames[this.selectedFrameIndex];
        const targetFrameWidthMM = selected.widthMM * (this.frameAdjustments.size / 100);
        const frameWidthPx = targetFrameWidthMM * pixelsPerMM;
        const frameHeight = (frameImg.height / frameImg.width) * frameWidthPx;
        const frameX = eyeCenterX - frameWidthPx / 2;
        const frameY = eyeCenterY - frameHeight / 2 + this.frameAdjustments.vertical;

        ctx.save();
        ctx.translate(eyeCenterX, eyeCenterY + this.frameAdjustments.vertical);
        ctx.rotate((this.frameAdjustments.rotation * Math.PI) / 180);
        ctx.translate(-eyeCenterX, -(eyeCenterY + this.frameAdjustments.vertical));
        ctx.drawImage(frameImg, frameX, frameY, frameWidthPx, frameHeight);
        ctx.restore();
      } else {
        // visual-only placement (no reliable px/mm): keep previous heuristic: frame = eyeDistance*3
        const frameWidth = eyeDistance * 3 * (this.frameAdjustments.size / 100);
        const frameHeight = (frameImg.height / frameImg.width) * frameWidth;
        const frameX = eyeCenterX - frameWidth / 2;
        const frameY = eyeCenterY - frameHeight / 2 + this.frameAdjustments.vertical;

        ctx.save();
        ctx.translate(eyeCenterX, eyeCenterY + this.frameAdjustments.vertical);
        ctx.rotate((this.frameAdjustments.rotation * Math.PI) / 180);
        ctx.translate(-eyeCenterX, -(eyeCenterY + this.frameAdjustments.vertical));
        ctx.drawImage(frameImg, frameX, frameY, frameWidth, frameHeight);
        ctx.restore();
      }
    };

    img.src = this.capturedPhoto;
  }

  resetAdjustments() {
    this.frameAdjustments = { vertical: 0, size: 100, rotation: 0 };
    document.getElementById("verticalSlider").value = 0;
    document.getElementById("sizeSlider").value = 100;
    document.getElementById("rotationSlider").value = 0;
    document.getElementById("verticalValue").textContent = "0";
    document.getElementById("sizeValue").textContent = "100%";
    document.getElementById("rotationValue").textContent = "0°";
    this.updateOverlay();
    this.recalculateAllMeasurements();
  }

  downloadImage() {
    const link = document.createElement("a");
    link.download = "virtual_tryon_" + Date.now() + ".png";
    link.href = this.overlayCanvas.toDataURL("image/png");
    link.click();
  }

  retake() {
    this.capturedPhoto = null;
    this.landmarks = null;
    this.alignmentCounter = 0;
    this.isCapturing = false;
    this.frameAdjustments = { vertical: 0, size: 100, rotation: 0 };
    this.measurements = {
      pdTotal: 0, pdLeft: 0, pdRight: 0, leftNose: 0, rightNose: 0,
      noseTotal: 0, fittingHeight: 0, faceWidth: 0, faceHeight: 0, faceRatio: 0, pixelsPerMM: 0,
    };

    document.getElementById("step2").classList.remove("active");
    document.getElementById("step1").classList.add("active");
    document.getElementById("startBtn").style.display = "inline-block";
    document.getElementById("faceGuide").classList.remove("aligned", "detecting");

    this.updateStatus("Click 'Start Camera' to begin", "misaligned");
  }

  updateStatus(message, className) {
    const status = document.getElementById("alignmentStatus");
    status.textContent = message;
    status.className = "alignment-status " + className;
  }

  showError(message) {
    const errorElement = document.getElementById("errorMessage");
    errorElement.textContent = message;
    errorElement.style.display = "block";
    setTimeout(() => { errorElement.style.display = "none"; }, 5000);
  }

  estimateDistanceCM() {
    if (!this.currentLandmarks) return null;

    // Eye corner landmarks (Mediapipe standard)
    const LEFT_EYE = this.currentLandmarks[33];
    const RIGHT_EYE = this.currentLandmarks[263];

    if (!LEFT_EYE || !RIGHT_EYE) return null;

    // Compute pixel distance between eyes
    const dx = (RIGHT_EYE.x - LEFT_EYE.x);
    const dy = (RIGHT_EYE.y - LEFT_EYE.y);
    const eyeDistPx = Math.sqrt(dx*dx + dy*dy);

    // ===== CASE 1: Calibration DONE (pixelsPerMM available) =====
    if (this.measurements?.pixelsPerMM) {
        const eyeDistMM = eyeDistPx * (1 / this.measurements.pixelsPerMM);

        const REAL_PD = 63; // average human PD in mm

        const scale = eyeDistMM / REAL_PD;  // How large the face appears
        const distance_cm = 45 / scale;     // 45 cm target reversed by scale

        return distance_cm;
    }

    // ===== CASE 2: Calibration NOT DONE → fallback =====
    // assume real PD = 63 mm
    const REAL_PD = 63;

    // assume face at perfect distance gives eyeDistPx ≈ 110–130 px (for 720p camera)
    // derive pixels→mm estimate from assumed PD
    const mmPerPixel = REAL_PD / eyeDistPx;

    // estimate distance
    const distance_cm = (eyeDistPx * mmPerPixel) / 10;  // convert mm→cm

    return distance_cm;
}


}

// create app instance
window.app = new FaceCaptureApp();

window.addEventListener("beforeunload", () => {
  if (app.stream) app.stream.getTracks().forEach((track) => track.stop());
  if (app.detectionInterval) clearInterval(app.detectionInterval);
});