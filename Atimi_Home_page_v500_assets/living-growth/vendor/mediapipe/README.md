# MediaPipe Tasks Vision

This directory vendors the browser runtime and hand landmark model used by the
Living Growth interaction. They are loaded only after camera access succeeds,
either during automatic startup or when the visitor enables Hand Control.

- Package: `@mediapipe/tasks-vision`
- Version: `0.10.35`
- Model: `hand_landmarker` float16, version 1
- Runtime source: https://www.npmjs.com/package/@mediapipe/tasks-vision
- Model source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- License: Apache License 2.0

Camera frames remain in the browser. The worker returns only a detection flag,
confidence score and normalized openness value to the page.
