// Shadertoy 4cdfzf — GT-VBAO (uniformly weighted)
// Author: TinyTexel (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Buffer C
// Source: https://www.shadertoy.com/view/4cdfzf
// Captured live via Chrome (gShaderToy state) on 2026-07-17

/*
    This work is licensed under a dual license, public domain and MIT, unless noted otherwise. Choose the one that best suits your needs:
    
    CC0 1.0 Universal https://creativecommons.org/publicdomain/zero/1.0/
    To the extent possible under law, the author has waived all copyrights and related or neighboring rights to this work.
    
    or
    
    The MIT License
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), 
    to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, 
    and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: 
    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. 
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, 
    DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR 
    THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

////////////////////////////////////////////////////////////////////////////////////// config
//==================================================================================//

/*
    toggles:
    
    Tab  : toggle temporal accumulation on/off
    Ctrl : toggle ortho cam off/on

    U    : toggle UI off/on
*/

// when using white noise, GT-VBAO converges exactly to the reference
//#define GTVBAO_USE_WHITE_NOISE
//#define  REFAO_USE_WHITE_NOISE

// #define USE_ANALYTICAL_RAYCASTING

const float Raymarching_SampleCount = 32.0;
const float Raymarching_Width = 512.0;
const float Thickness = 0.5;

//==================================================================================//
////////////////////////////////////////////////////////////////////////////////////// 


bool isLeft;// true on the left half of the screen; for debugging purposes

#define KeyBoard iChannel3

float ReadKey(int keyCode) {return texelFetch(KeyBoard, ivec2(keyCode, 0), 0).x;}
float ReadKeyToggle(int keyCode) {return texelFetch(KeyBoard, ivec2(keyCode, 2), 0).x;}

#define VarTex iChannel3
#define OutCol outCol
#define OutChannel w

#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}
#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}

float ReadVar(int cx, int cy) {return texelFetch(VarTex, ivec2(cx, cy), 0).OutChannel;}
vec4 ReadVar4(int cx, int cy) {return vec4(ReadVar(cx, cy), ReadVar(cx, cy + 1), ReadVar(cx, cy + 2), ReadVar(cx, cy + 3));}


////////////////////////////////////////////////////////////////////////////////////// quaternion utils
//==================================================================================//

vec4 GetQuaternion(vec3 from, vec3 to)
{
    vec3 xyz = cross(from, to);
    float s  =   dot(from, to);

    float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
    
    s    = 1.0 / u;
    xyz *= u * 0.5;

    return vec4(xyz, s);  
}

vec4 GetQuaternion(vec3 to)
{
#if 1
    //vec3 from = vec3(0.0, 0.0,-1.0);

    vec3 xyz = vec3( to.y,-to.x, 0.0);// cross(from, to);
    float s  =                  -to.z;//   dot(from, to);
#else
    //vec3 from = vec3(0.0, 0.0, 1.0);

    vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
    float s  =                   to.z;//   dot(from, to);
#endif

    float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
    
    s    = 1.0 / u;
    xyz *= u * 0.5;

    return vec4(xyz, s);  
}

// transform v by unit quaternion q.xyzs
vec3 Transform(vec3 v, vec4 q)
{
    vec3 k = cross(q.xyz, v);
    
    return v + 2.0 * vec3(dot(vec3(q.wy, -q.z), k.xzy),
                          dot(vec3(q.wz, -q.x), k.yxz),
                          dot(vec3(q.wx, -q.y), k.zyx));
}

// transform v by unit quaternion q.xy0s
vec3 Transform_Qz0(vec3 v, vec4 q)
{
    float k = v.y * q.x - v.x * q.y;
    float g = 2.0 * (v.z * q.w + k);
    
    vec3 r;
    r.xy = v.xy + q.yx * vec2(g, -g);
    r.z  = v.z  + 2.0 * (q.w * k - v.z * dot(q.xy, q.xy));
    
    return r;
}

// transform v.xy0 by unit quaternion q.xy0s
vec3 Transform_Vz0Qz0(vec2 v, vec4 q)
{
    float o = q.x * v.y;
    float c = q.y * v.x;
    
    vec3 b = vec3( o - c,
                  -o + c,
                   o - c);
    
    return vec3(v, 0.0) + 2.0 * (b * q.yxw);
}

//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////// blue noise utils
//==================================================================================//

// increases bit depth of 8 bit per channel blue noise texture
vec4 MixBlueNoiseBits(vec4 bnoise)
{
   const vec4 a = exp2(-vec4(0.0, 8.0, 16.0, 24.0));
   const vec4 b = a / (a.x + a.y + a.z + a.w);

   return vec4(dot(bnoise.xyzw, b), 
               dot(bnoise.yzwx, b), 
               dot(bnoise.zwxy, b), 
               dot(bnoise.wxyz, b));
}

// blue noise randomized via uv jittering
vec4 BlueNoise01x4(uvec2 uv, uint n)
{
    const uint res = 1024u;

    ivec2 uvi = ivec2((uv + (rPhi2 * n)) & (res - 1u));

    return MixBlueNoiseBits(texelFetch(iChannel1, uvi, 0));
}

// blue noise randomized via value jittering
// -> stratifies values along the time axis
float BlueNoise01(uvec2 uv, uint n)
{
    const uint res = 1024u;

    ivec2 uvi = ivec2(uv & (res - 1u));

    float rnd01 = MixBlueNoiseBits(texelFetch(iChannel1, uvi, 0)).r;    

    return Float01(uint(rnd01 * 4294967295.0) + rPhi1 * n);// == fract(rnd01 + rPhif1 * float(n));
}

//==================================================================================//
////////////////////////////////////////////////////////////////////////////////////// 


////////////////////////////////////////////////////////////////////////////////////// GT-VBAO
//==================================================================================//

// returns 4 uniformly distributed rnd numbers [0,1]
// rnd01.x/rnd01.xy -> used to sample a slice direction (exact importance sampling needs 2 rnd numbers)
// rnd01.z -> used to jitter sample positions along ray marching direction
// rnd01.w -> used to jitter sample positions radially around slice normal
vec4 Rnd01x4(vec2 uv, uint n)
{
    uvec2 uvu = uvec2(uv);

    vec4 rnd01 = vec4(0.0);
        
   #ifdef GTVBAO_USE_WHITE_NOISE
    rnd01.xzw = Hash01x3(uvec3(uvu, n), 0x9CF617FAu);
   #else
    rnd01.x  = BlueNoise01  (uvu, n);
  //rnd01.x  = IGN(floor(uv), n);
  //rnd01.y  = unused
    rnd01.zw = BlueNoise01x4(uvu, n).zw;
   #endif
    
    return rnd01;
}

// https://graphics.stanford.edu/%7Eseander/bithacks.html#CountBitsSetParallel | license: public domain
uint CountBits(uint v)
{
    v = v - ((v >> 1u) & 0x55555555u);
    v = (v & 0x33333333u) + ((v >> 2u) & 0x33333333u);
    return ((v + (v >> 4u) & 0xF0F0F0Fu) * 0x1010101u) >> 24u;
}

float SliceRelCDF_Uniform(float horCos, float sinN, bool isPhiLargerThanAngN)
{
    bool c = isPhiLargerThanAngN;

    float m0 = c ? 1.0 : 0.0;
    float m1 = c ?-0.5 : 0.5;

    float d0 = m0 + m1 * horCos + (0.5 * sinN);
    
    return d0;
}

vec2 SliceRelCDF_Uniform(vec2 horCos, float sinN, bool isPhiLargerThanAngN)
{
    return vec2(SliceRelCDF_Uniform(horCos.x, sinN, isPhiLargerThanAngN),
                SliceRelCDF_Uniform(horCos.y, sinN, isPhiLargerThanAngN));
}

float hemiGTVBAO(vec2 uv0, vec3 wpos, vec3 N, uint dirCount)
{
    vec3 positionVS = VPos_from_WPos(wpos);
    vec3 normalVS   = VVec_from_WVec(N);
    
    vec3 V = isPerspectiveCam ? -normalize(positionVS) : vec3(0.0, 0.0, -1.0);
    
    vec2 rayStart = SPos_from_VPos(positionVS).xy;

    uint frame = USE_TEMP_ACCU_COND ? uint(iFrame) : 0u;
        
    float ao = 0.0;
    
    for(uint i = 0u; i < dirCount; ++i)
    {
        uint n = frame * dirCount + i;
        vec4 rnd01 = Rnd01x4(uv0, n);
        
        ////////////////////////////////////////////////// slice direction sampling
        vec3 smplDirVS;// view space sampling vector
        vec2 dir;// screen space sampling vector
        {
            dir = vec2(cos(rnd01.x * Pi), sin(rnd01.x * Pi));
            smplDirVS = vec3(dir, 0.0);

            if(isPerspectiveCam)
            {
                // set up View Vec Space -> View Space mapping
                vec4 Q_toV = GetQuaternion(V);

                smplDirVS = Transform_Vz0Qz0(dir, Q_toV);

                vec3 rayStart = SPos_from_VPos(positionVS);
                vec3 rayEnd   = SPos_from_VPos(positionVS + smplDirVS*(nearZ*0.5));

                vec3 rayDir   = rayEnd - rayStart;

                rayDir /= length(rayDir.xy);

                dir = rayDir.xy;
            }
        }
        //////////////////////////////////////////////////
        
        ////////////////////////////////////////////////// construct slice
        float cosN, sinN, projNRcpLen;
        {
            vec3 sliceN = cross(V, smplDirVS);

            vec3 projN = normalVS - sliceN * dot(normalVS, sliceN);

            float projNSqrLen = dot(projN, projN);
               if(projNSqrLen == 0.0) return 1.0;

            vec3 T = cross(sliceN, projN);

            projNRcpLen = inversesqrt(projNSqrLen);

            cosN = dot(projN, V) * projNRcpLen;
            sinN = dot(T    , V) * projNRcpLen;
        }
        //////////////////////////////////////////////////

        // find horizons
        uint occBits = 0u;
        for(float d = -1.0; d <= 1.0; d += 2.0)
        {
            vec2 rayDir = dir.xy * d;
            
            const float count = Raymarching_SampleCount;
            
            const float s = pow(Raymarching_Width, 1.0/count);
            
            float t = pow(s, rnd01.z);// init t: [1, s]
            
            rnd01.z = 1.0 - rnd01.z;
            
            for (float i = 0.0; i < count; ++i)
            {
                vec2 samplePos = rayStart + rayDir * t;
                
                t *= s;
                
                // handle oob
                if(samplePos.x < 0.0 || samplePos.x >= iResolution.x || samplePos.y < 0.0 || samplePos.y >= iResolution.y) break;
                
                float sampleDepth = textureLod(iChannel2, samplePos / Resolution.xy, 0.0).w;
                
                vec3 samplePosVS = VPos_from_SPos(vec3(samplePos, sampleDepth));

                vec3 deltaPosFront = samplePosVS - positionVS;
                vec3 deltaPosBack  = deltaPosFront - V * Thickness;
                
               #if 1
                // required for correctness, but probably not worth to keep active in a practical application:
                if(isPerspectiveCam)
                {
                   #if 1
                    deltaPosBack = VPos_from_SPos(vec3(samplePos, sampleDepth + Thickness)) - positionVS;
                   #else
                    // also valid, but not consistent with reference ray marcher
                    deltaPosBack = deltaPosFront + normalize(samplePosVS) * Thickness;
                   #endif
                }
               #endif

                // project samples onto unit circle and compute cos(angles) relative to V
                vec2 horCos = vec2(dot(normalize(deltaPosFront), V), 
                                   dot(normalize(deltaPosBack ), V));

                // sampling direction flips min/max cos(angles)
                horCos = d >= 0.0 ? horCos.xy : horCos.yx;
                
                // map to slice relative distribution
                vec2 hor01;// = SliceRelCDF_Uniform(horCos, sinN, d > 0.0);
                {
                    float d05 = d * 0.5;

                    hor01 = ((0.5 + 0.5 * sinN) + d05) - d05 * horCos;
                }

                // jitter sample locations + clamp01
                hor01 = clamp(hor01 + rnd01.w * (1.0/32.0), 0.0, 1.0);
               
                uint occBits0;// turn arc into bit mask
                {
                    uvec2 horInt = uvec2(floor(hor01 * 32.0));

                    uint OxFFFFFFFFu = 0xFFFFFFFFu;// don't inline here! ANGLE bug: https://issues.angleproject.org/issues/353039526

                    uint mX = horInt.x < 32u ? OxFFFFFFFFu <<        horInt.x  : 0u;
                    uint mY = horInt.y != 0u ? OxFFFFFFFFu >> (32u - horInt.y) : 0u;

                    occBits0 = mX & mY;            
                }

                occBits = occBits | occBits0;
            }
        }
        
        float occ0 = float(CountBits(occBits)) * (1.0/32.0);

        ao += 1.0 - occ0;
    }
    
    ao /= float(dirCount);
    
    return ao;
}

//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////// reference AO
//==================================================================================//

float ReferenceAO(vec2 uv0, vec3 wpos, vec3 N, uint dirCount)
{
    uvec2 uvu = uvec2(uv0);

   #ifndef REFAO_USE_WHITE_NOISE
    // randomly shift noise pattern around
    if(USE_TEMP_ACCU_COND) uvu += Hash(uvec2(iFrame, 0u), 0xBD1E0BB0u).xy;

    // linearize uv in a locality preserving way
    uint pxId = EvalHilbertCurve(uvu, 9u);
   #endif

    vec3 positionVS = VPos_from_WPos(wpos);

    uint frame = USE_TEMP_ACCU_COND ? uint(iFrame) : 0u;

    float occ = 0.0;
    
    for(uint i = 0u; i < dirCount; ++i)
    {
        uint n = frame * dirCount + i;
        
      #ifdef REFAO_USE_WHITE_NOISE
        vec2 s = Hash11x2(uvec3(uvu, n), 0x3579A945u);
      #else
        uint h = pxId * dirCount + i;
        vec2 s = Float11(shuffled_scrambled_sobol_2d(h, 0xCC925D21u));
      #endif
        
        vec3 rayDir = Sample_Sphere(s); 
        
        // uniform weighted hemisphere
        rayDir -= N * min(dot(rayDir, N) * 2.0, 0.0);// flip if on wrong side
        
       #ifdef USE_ANALYTICAL_RAYCASTING
        {
            float t; vec3 n; vec3 a;
            occ += Intersect_Scene(wpos, rayDir, /*out:*/ t, n, a) > 0.0 ? 1.0 : 0.0;
        }
       #else
        // ray march in screen space
        if(isPerspectiveCam)
        {
            vec4 rayStart = PPos_from_WPos(wpos);
            vec4 rayEnd   = PPos_from_WPos(wpos + rayDir * (nearZ * 0.5));
            
            float rwStart = 1.0 / rayStart.w;
            float rwEnd   = 1.0 / rayEnd.w;
            
            vec2 tcStart = rayStart.xy * rwStart * 0.5 + 0.5;
            vec2 tcEnd   = rayEnd.xy   * rwEnd   * 0.5 + 0.5;
            
            vec2  tcDelta0 = tcEnd - tcStart;
            float rwDelta0 = rwEnd - rwStart;
            
            vec2  uvDelta0       = tcDelta0 * iResolution.xy;
            float uvDelta0RcpLen = inversesqrt(dot(uvDelta0, uvDelta0));

            // 1 px step size
            vec2  tcDelta = tcDelta0 * uvDelta0RcpLen;
            float rwDelta = rwDelta0 * uvDelta0RcpLen;
            
            float rnd01 = Hash01(uvec3(uvu, n), 0x2D56DA3Bu);

            const float count = Raymarching_SampleCount;
            
            const float s = pow(Raymarching_Width, 1.0/count);
            
            float t = pow(s, rnd01);// init t: [1, s]

            for (float i = 0.0; i < count; ++i)
            {
                vec2  tc = tcStart + tcDelta * t;
                float rw = rwStart + rwDelta * t;

                t *= s;

                float depth = 1.0 / rw;

                // handle oob
                if(tc.x < 0.0 || tc.x >= 1.0 || tc.y < 0.0 || tc.y >= 1.0) break;
                
                float sampleDepth = textureLod(iChannel2, tc.xy, 0.0).w;

                if(depth > sampleDepth && depth < sampleDepth + Thickness)
                {
                    occ += 1.0;
                    
                    break;
                }
             }
        }
        else
        {
            vec3 rayStart = SPos_from_WPos(wpos);
            vec3 rayDir   = SVec_from_VVec_Ortho(VVec_from_WVec(rayDir));
            
            // 1 px step size
            rayDir /= length(rayDir.xy);

            float rnd01 = Hash01(uvec3(uvu, n), 0x2D56DA3Bu);

            const float count = Raymarching_SampleCount;
                        
            const float s = pow(Raymarching_Width, 1.0/count);
            
            float t = pow(s, rnd01);// init t: [1, s]
            
            for (float i = 0.0; i < count; ++i)
            {
                vec3 samplePos = rayStart + rayDir * t;
                
                t *= s;

                vec2 tc = samplePos.xy / iResolution.xy;

                // handle oob
                if(tc.x < 0.0 || tc.x >= 1.0 || tc.y < 0.0 || tc.y >= 1.0) break;
                
                float sampleDepth = textureLod(iChannel2, tc.xy, 0.0).w;

                if(samplePos.z > sampleDepth && samplePos.z < sampleDepth + Thickness)
                {
                    occ += 1.0;
                    
                    break;
                }
            }
        }
       #endif
    }
    
    occ /= float(dirCount);
    
    return 1.0 - occ;
}

//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////


void mainImage(out vec4 outCol, in vec2 uv0)
{     
    Resolution = iResolution.xy;
    isLeft = uv0.x < iResolution.x * 0.5;
    
    vec4 mouseAccu  = ReadVar4(1, VAR_ROW);
    float frameAccu = ReadVar (3, VAR_ROW);
    
    PrepareCam(mouseAccu, USE_PERSPECTIVE_CAM_COND);
    
    vec4 gbuffer = textureLod(iChannel2, uv0 / iResolution.xy, 0.0);
    vec3  N     = gbuffer.xyz;
    float depth = gbuffer.w;
    
    if(depth >= exp2(10.0))
    {
        outCol = vec4(0.0);
        
        return;
    }
    
    vec3 spos = vec3(uv0, depth);
    
    vec3 wpos = WPos_from_SPos(spos);
    // need a larger offset here when using uniform hemisphere weighting 
    // due to increased potential for self-shadowing
    wpos += N * (4.0/1024.0);
    
    vec3 col = vec3(0.0);

    float refao;
    {
        uint count = 2u;// set to 2 to make comparison fair since GTVBAO marches bidirectionally
        
        refao = ReferenceAO(uv0, wpos, N, count);
    }
    
    float ssao;
    {
        uint count = 1u;
        
        ssao = hemiGTVBAO(uv0, wpos, N, count);
    }
    
    col = vec3(refao, ssao, 0.0);
    
    // accumulate frames
    if(USE_TEMP_ACCU_COND)
    {
        vec2 tc = uv0.xy / iResolution.xy;
    
        vec4 colLast = textureLod(iChannel0, tc, 0.0);

        col = mix(colLast.rgb, col, 1.0 / (frameAccu));
        
        frameAccu += 1.0;
        
        outCol = vec4(col.rgb, frameAccu);
        
        return;
    }
   
    outCol = vec4(col, 0.0);
}
