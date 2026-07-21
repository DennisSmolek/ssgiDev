# lab11-noise-mse

- commit: 6f5b91e-dirty
- date: 2026-07-21T03:48:39.597Z
- baseUrl: http://localhost:5180/
- scene: cornell
- truthFrames: 512
- frames: [8,32,128]
- config: {"viewMode":"combined","noise":"white","temporalAdvance":true,"slicesPerFrame":1,"stepsPerSlice":32,"marchWidthPx":512,"thickness":0.5,"bias":0.03,"falloff":0,"acosApprox":true,"importanceSampling":true,"thicknessNormalize":false,"accumulate":true,"jitterAA":false,"maxAccumFrames":128,"denoiseRadius":3,"denoiseSpatial":2.5,"denoiseDepth":0.2,"denoiseNormalPow":16,"refRays":8,"refSteps":32,"refRadius":6,"compareMode":"diff","diffAmp":8}

| noise | mse8 | mse32 | mse128 | shimmer |
|---|---|---|---|---|
| white | 0.0036 | 0.002 | 0.0014 | 0.1036 |
| ign | 0.0021 | 0.0016 | 0.0014 | 0.1393 |
| hilbert | 0.0024 | 0.0016 | 0.0013 | 0.0955 |
| blue | 0.0024 | 0.0016 | 0.0013 | 0.0954 |
| stbn | 0.0036 | 0.0026 | 0.0023 | 0.1033 |
