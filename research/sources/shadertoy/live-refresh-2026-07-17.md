# Live refresh audit — 2026-07-17

All 11 archive-recovered shaders were re-captured live from Shadertoy via Chrome
(`gShaderToy` editor state) and the pass files under each `<ID>/` were replaced with
the live code. This file records exactly what had changed between the GabeRundlett
archive snapshots (2024-07 → 2025-02) and the live shaders as of 2026-07-17.
The three post-archive shaders (`dsGBzW`, `wc2SzR`, `wcsXDN`) were captured live
the same day and have no archive baseline.

## XXGSDd — GT-VBAO

### Image

```diff
--- archive
+++ live
@@ -122,4 +122,6 @@
         - unidirectional GT-VBGI: https://www.shadertoy.com/view/XcdBWf
         
+        - GT-VBAO [Distant Light Sampling]: https://www.shadertoy.com/view/wc2SzR
+
         -  bidirectional GT-VBAO: https://www.shadertoy.com/view/XXGSDd
         - unidirectional GT-VBAO: https://www.shadertoy.com/view/Xc3yzs
```

### Buffer C

```diff
--- archive
+++ live
@@ -339,8 +339,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
```

## Xc3yzs — GT-VBAO (unidirectional)

### Buffer C

```diff
--- archive
+++ live
@@ -300,8 +300,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
@@ -618,4 +625,5 @@
         // percentage of the slice we don't use ([0, angN]-integrated slice-relative pdf)
         float w0 = clamp((sin(angN) / (cos(angN) + angN * sin(angN))) * (Pi/4.0) + 0.5, 0.0, 1.0);
+            //w0 = SliceRelCDF_Cos(angN * RcpPi + 0.5, angN, cosN, false);
         
         // partial slice re-mapping constants
```

## lctBzH — GTAO+

### Buffer C

```diff
--- archive
+++ live
@@ -244,8 +244,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
```

## 4ctBRH — GTAO+ (unidirectional)

### Buffer C

```diff
--- archive
+++ live
@@ -311,8 +311,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
@@ -321,5 +328,5 @@
     xyz *= u * 0.5;
 
-    return vec4(xyz, s);  
+    return vec4(xyz, s);
 }
 
```

## lfdBWn — GT-VBGI (diffuse)

### Image

```diff
--- archive
+++ live
@@ -75,5 +75,7 @@
         
         - optimized uniformly weighted, bidirectional GT-VBGI: https://www.shadertoy.com/view/XfcBDl
-    
+
+        - GT-VBAO [Distant Light Sampling]: https://www.shadertoy.com/view/wc2SzR
+
         -  bidirectional GT-VBAO: https://www.shadertoy.com/view/XXGSDd
         - unidirectional GT-VBAO: https://www.shadertoy.com/view/Xc3yzs
```

### Buffer C

```diff
--- archive
+++ live
@@ -256,8 +256,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
```

## 4cdfzf — GT-VBAO (uniformly weighted)

### Buffer C

```diff
--- archive
+++ live
@@ -80,8 +80,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
```

## XcdBWf — GT-VBGI (diffuse) (unidir)

### Buffer C

```diff
--- archive
+++ live
@@ -302,8 +302,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
```

## XfcBDl — GT-VBGI (uniformly weighted)

### Buffer C

```diff
--- archive
+++ live
@@ -78,8 +78,15 @@
 vec4 GetQuaternion(vec3 to)
 {
+#if 1
+    //vec3 from = vec3(0.0, 0.0,-1.0);
+
+    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
+    float s  =                  -to.z;//   dot(from, to);
+#else
     //vec3 from = vec3(0.0, 0.0, 1.0);
 
     vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
     float s  =                   to.z;//   dot(from, to);
+#endif
 
     float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
```

## wcfGWB — GT-VBAO distant light sampling: unchanged

## 3clGWB — GT-VBAO thickness heuristic: unchanged

## wcBGRz — GT-VBAO Light&Occluder Heuristic: unchanged

