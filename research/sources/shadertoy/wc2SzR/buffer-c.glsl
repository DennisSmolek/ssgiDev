// Shadertoy wc2SzR — GT-VBAO [Distant Light Sampling]
// Author: TinyTexel (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Buffer C
// Source: https://www.shadertoy.com/view/wc2SzR
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

/*
    1: uniform sampling + slice weighting (works for gi almost as well as 3)
    2: exact  importance sampling via 2 random numbers
    3: approx importance sampling via 1 random number (default)
    -> only used if cosine weighting is active (otherwise uniform sampling is used)
*/
#define GTVBAO_SLICE_SAMPLING_MODE 3

//#define GTVBAO_USE_WHITE_NOISE

/*
    1: GTAOFastAcos         : fastest; good enough
    2: improved GTAOFastAcos: slightly slower than 1, but quite a bit better
    3: acos                 : very slow, but very accurate (useful for testing/debugging)
*/
#define ACOS_QUALITY_MODE 2

//#define USE_HQ_APPROX_SLICE_IMPORTANCE_SAMPLING // has numerical issues when looking straight at surface


// evaluate all 32 sampling directions using the reference dir-mapping:
#define USE_REFERENCE_DISTANT_LIGHT_SAMPLING
// ..otherwise 8 sampling directions + basic dir-mapping are used

#ifdef USE_REFERENCE_DISTANT_LIGHT_SAMPLING
    // use low-error variants for testing (so there is as little unintentional bias as possible when comparing to reference)
    #undef  ACOS_QUALITY_MODE
    #define ACOS_QUALITY_MODE 3
    
    #undef  GTVBAO_SLICE_SAMPLING_MODE
    #define GTVBAO_SLICE_SAMPLING_MODE 1
#endif

//==================================================================================//
////////////////////////////////////////////////////////////////////////////////////// 


bool isLeft;// true on the left half of the screen; for debugging purposes

#define KeyBoard iChannel3
#define KeyBoardChannel w

float ReadKey(int keyCode) {return texelFetch(KeyBoard, ivec2(keyCode, 0), 0).KeyBoardChannel;}
float ReadKeyToggle(int keyCode) {return texelFetch(KeyBoard, ivec2(keyCode, 2), 0).KeyBoardChannel;}

#define VarTex iChannel3
#define OutCol outCol
#define OutChannel w

#define WriteVar(v, cx, cy) {if(uv.x == uint(cx) && uv.y == uint(cy)) OutCol.OutChannel = v;}
#define WriteVar4(v, cx, cy) {WriteVar(v.x, cx, cy) WriteVar(v.y, cx, cy + 1) WriteVar(v.z, cx, cy + 2) WriteVar(v.w, cx, cy + 3)}

float ReadVar(int cx, int cy) {return texelFetch(VarTex, ivec2(cx, cy), 0).OutChannel;}
vec4 ReadVar4(int cx, int cy) {return vec4(ReadVar(cx, cy), ReadVar(cx, cy + 1), ReadVar(cx, cy + 2), ReadVar(cx, cy + 3));}


////////////////////////////////////////////////////////////////////////////////////// acos approx
//==================================================================================//

float ACosPoly(float x)
{
#if ACOS_QUALITY_MODE == 1
    // GTAOFastAcos
    return 1.5707963267948966 - 0.1565827644218014 * x;
#else    
    // higher quality version of GTAOFastAcos (for the cost of one additional mad)
    // minimizes max abs(ACos_Approx(cos(x)) - x)
    return 1.5707963267948966 + (-0.20491203466059038 + 0.04832927023878897 * x) * x;
#endif    
}

float ACos_Approx(float x)
{
    float u = ACosPoly(abs(x)) * sqrt(1.0 - abs(x));
			
    return x >= 0.0 ? u : Pi - u;
}

float ACos01_Approx(float x)// x: [0,1]
{
    return ACosPoly(x) * sqrt(1.0 - x);
}

#if ACOS_QUALITY_MODE == 1 || ACOS_QUALITY_MODE == 2
float ACos(float x)
{
    return ACos_Approx(clamp(x, -1.0, 1.0));
}
#else
float ACos(float x)// very slow; for debugging
{   
    return acos(clamp(x, -1.0, 1.0));
}
#endif

vec2 ACos(vec2 v)
{
    return vec2(ACos(v.x), ACos(v.y));
}

/*
float ACos_Approx(float x)// invertible, but less good than the ones above
{
    float v = x < 0.0 ? Pi : 0.0;
    
    x = abs(x);

    // minimizes max abs(ACos_Approx(cos(x)) - x)
    float s = 0.21545;
    float s1 = -(s + 1.0);
    
    float u = (x * s + s1) * x + 1.0;
    
    float ang = abs(v - Pi05 * sqrt(clamp(u, 0.0, 1.0)));
    
    return ang;
}
*/

//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////// slice sampling
//==================================================================================//

// vvsN: view vec space normal | rnd01: [0, 1]
vec2 SampleSliceDir(vec3 vvsN, float rnd01)
{
    float ang0 = rnd01 * Pi;

    vec2 dir0 = vec2(cos(ang0), sin(ang0));
            
    float l = length(vvsN.xy);

    if(l == 0.0) return dir0;
    
    // flip dir0 into hemi-circle of rsN.xy
    float flip = dot(dir0, vvsN.xy) < 0.0 ? -1.0 : 1.0;
    dir0 *= flip;
    
    vec2 n = vvsN.xy / l;
    
    // SampleSlice(..) inlined + optimized
    vec2 dir;
    {
        float x = dir0.x * n.y - dir0.y * n.x;// dir0 x n
        
        float s = l;// acos stretch param; chosen to approx match ref pdf
        {
            // quadratic bias
            s += (s - s * s) * 0.15;
        }
        
       #ifdef USE_HQ_APPROX_SLICE_IMPORTANCE_SAMPLING
        float y = acos(x * sin(s * Pi05)) * RcpPi05;// stretched acos
        
        float ys = 1.0 / -s;// remap curve along y
       #else
        // approximation (not that much faster, but apparently more numerically stable)
        float k = 0.21545;// asin approx param
        
        float xs;// inverse approx asin
        {
            float a = 0.5 + 0.5 / k;
            float b = 0.5 - 0.5 / k;
            float d = b * b;
            float c = 4.0 / k;

            xs = 0.5 - 0.5 * s;
            xs = a - sqrt(d + c * (xs*xs));
        }
        
        x *= xs;// stretch curve along x
        
        float y;// approx acos
        {
            float v = x > 0.0 ? 2.0 : 0.0;

            float g = -k - 1.0;

            float u = (abs(x) * k + g) * abs(x) + 1.0;

            y = abs(v - sqrt(clamp(u, 0.0, 1.0)));        
        }
        
        float ys = 1.0 / s;// remap curve along y
       #endif
                
        dir.y = ys - ys * y;// [-1, 1]
        dir.x = sqrt(clamp(1.0 - dir.y*dir.y, 0.0, 1.0));// [0, 1]
    }    
    
    // align x-axis with n
	return vec2(dir.x * n.x - dir.y * n.y, 
		        dir.y * n.x + dir.x * n.y);// * flip;
}


//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////// quaternion utils
//==================================================================================//

vec4 GetQuaternion(vec3 from, vec3 to)
{
    vec3 xyz = cross(from, to);
    float s  =   dot(from, to);

    float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
        //u = s < -1.0 + exp2(-20.0) ? 1.0 : u;
    
    s    = 1.0 / u;
    xyz *= u * 0.5;

    return vec4(xyz, s);  
}

vec4 GetQuaternion(vec3 to)
{
    //vec3 from = vec3(0.0, 0.0, 1.0);

    vec3 xyz = vec3(-to.y, to.x, 0.0);// cross(from, to);
    float s  =                   to.z;//   dot(from, to);

    float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
        //u = s < -1.0 + exp2(-20.0) ? 1.0 : u;
          
    s    = 1.0 / u;
    xyz *= u * 0.5;

    return vec4(xyz, s);  
}

vec4 GetQuaternion1(vec3 to)
{
    //vec3 from = vec3(0.0, 0.0,-1.0);

    vec3 xyz = vec3(to.y, -to.x, 0.0);// cross(from, to);
    float s  =                  -to.z;//   dot(from, to);

    float u = inversesqrt(max(0.0, s * 0.5 + 0.5));// rcp(cosine half-angle formula)
         //u = s < -1.0 + exp2(-20.0) ? 1.0 : u;
          
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
    float b = q.x * v.y - q.y * v.x;
    
    return vec3(v + vec2(2.0, -2.0) * b * q.yx, 
                               2.0  * b * q.w);
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
    
  #if GTVBAO_SLICE_SAMPLING_MODE == 1 || GTVBAO_SLICE_SAMPLING_MODE == 3
    
   #ifdef GTVBAO_USE_WHITE_NOISE
    rnd01.xzw = Hash01x3(uvec3(uvu, n), 0x9CF617FAu);
   #else
    rnd01.x  = BlueNoise01  (uvu, n);
  //rnd01.x  = IGN(floor(uv), n);
  //rnd01.y  = unused
    rnd01.zw = BlueNoise01x4(uvu, n).zw;
   #endif
    
  #elif GTVBAO_SLICE_SAMPLING_MODE == 2
        
   #ifdef GTVBAO_USE_WHITE_NOISE
    rnd01 = Hash01x4(uvec3(uvu, n), 0x9CF617FAu);
   #else
    rnd01   = BlueNoise01x4(uvu, n);
    rnd01.x = BlueNoise01  (uvu, n);
   #endif
   
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


// optimized SliceRelCDF_Cos:
vec4 SliceRelCDF_Cos_Map(float angN, float cosN, float sinN)
{
    float a = sinN * angN + cosN;
    float b = cosN * 0.25;
    vec2  c = sinN * Pi025 + vec2(b, a - b);
    float d = 1.0 / a;
    float e = d * 0.25;
    
    return vec4(e, -e, c * d);
}

float SliceRelCDF_Cos(float phi2, float angN, float sinN, vec2 mapN)
{
    float y = sinN * phi2 + cos(angN - phi2);
    
    return y * mapN.x + mapN.y;
}

// old SliceRelCDF_Cos:
float SliceRelCDF_Cos(float x, float angN, float cosN, bool isPhiLargerThanAngN)
{
    if(x <= 0.0 || x >= 1.0) return x;
    
    float phi = x * Pi - Pi05;

    bool c = isPhiLargerThanAngN;
    
    float n0 = c ?  3.0 : 1.0;
    float n1 = c ? -1.0 : 1.0;
    float n2 = c ?  4.0 : 0.0;
    
    float t0 = n0 * cosN + n1 * cos(angN - 2.0 * phi) + (n2 * angN + (n1 * 2.0) * phi + Pi) * sin(angN);
    float t1 = 4.0 * (cosN + angN * sin(angN));

    return t0 / t1;
}

float SliceRelCDF_Cos(float x, float angN, float cosN)
{
    if(x <= 0.0 || x >= 1.0) return x;
    
    float phi = x * Pi - Pi05;

    bool c = phi > angN;
    
    float n0 = c ?  3.0 : 1.0;
    float n1 = c ? -1.0 : 1.0;
    float n2 = c ?  4.0 : 0.0;
    
    float t0 = n0 * cosN + n1 * cos(angN - 2.0 * phi) + (n2 * angN + (n1 * 2.0) * phi + Pi) * sin(angN);
    float t1 = 4.0 * (cosN + angN * sin(angN));

    return t0 / t1;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////// DISTANT LIGHT SAMPLING
// ================================================================================================================ //

///////////////////////////////////////////////////////////////////////////////////////
// SliceRelInverseCDF0_Cos_Ref: reference inverse cdf (brute force numerical inversion)
float SliceRelCDF0_Cos_Toe(float x, float s)
{
    s *= Pi;
    
    float cs = cos(s) * s;
    float ss = sin(s);
    
    float n = x * cs - ss + sin(s - s * x);
    float d =     cs - ss;
    
    return n / d;
}

float SliceRelInverseCDF0_Cos_Toe(float y, float s)
{
    float x0 = 0.0;
    float x1 = 1.0;
    
    float f0 = 0.0 - y;
    float f1 = 1.0 - y;
    
    float count = 23.0;
    for(float i = 0.0; i < count; ++i)
    {
        float x = (x0 + x1) * 0.5;

        float f = SliceRelCDF0_Cos_Toe(x, s) - y;
        
        if(f < 0.0)
        {
            x0 = x;
            f0 = f;
        }
        else
        {
            x1 = x;
            f1 = x;
        }
    }

    float w = clamp01(f0 / (f0 - f1));
    
    return x0 * (1.0 - w) + x1 * w;
}

float SliceRelInverseCDF0_Cos_Ref11(float x, float s)
{
    float u = x > 0.0 ? -1.0 : 1.0;
    
    return SliceRelInverseCDF0_Cos_Toe(x * u + 1.0, s) * u - u;
}
/////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////
// InvSinstep: poor quality approximation of the inverse cdf
float InvSinstep11(float x)
{
    float u = x > 0.0 ? -1.0 : 1.0;
    
    x = x * u + 1.0;
    
  #if 1
    float y = sqrt(x) * (0.88835 + 0.11165 * x);// least squares
        //y = sqrt(x) * mix(0.88835, 1.0, x);// least squares
        //y = sqrt(x) * mix(0.9003163161571062, 1.0, x);// match derivative at x=0
        //y = sqrt(x) * mix(0.8633802276324186, 1.0, x);// match derivative at x=1
  #else
    float y = sqrt(x) * (0.9003163161571062 + x * (0.07769284616641428 + (0.007045586828271703 + 0.014945250848207962 * x) * x));
  #endif
     
    return y * u - u;
}
/////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////
// SliceRelInverseCDF0_Cos_A: low quality approximation of the inverse cdf
float SliceRelInverseCDF0_Cos_A_uFromAngN(float x)
{
    return 1.0 + x * (1.4135 + (0.718749 + 0.142714 * x) * x);
}

float SliceRelInverseCDF0_Cos_A11(float x, float u)
{
  #if 1
    float invSin = InvSinstep11(x);
    float invCub = invSin * (1.04655 - 0.04655 * (invSin*invSin));
        //invCub = cos(invSin * (Pi/-6.0) + (Pi/2.0)) * 2.0;
  #else
    float ac = acos(x);
    
    const vec2 n = vec2(    1.0,  Pi/3.0);
    const vec2 m = vec2(-2.0/Pi, 1.0/3.0);
    
    float invSin =     ac * m.x + n.x;
    float invCub = cos(ac * m.y + n.y) * 2.0;
  #endif
    
    return mix(invCub, invSin, u);
}
/////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////
// SliceRelInverseCDF0_Cos_B: medium quality approximation of the inverse cdf
float SliceRelInverseCDF0_Cos_B_kFromS(float x)
{
    const float a = 0.419;
    const float b = 0.903;
    const float c = -0.2199307887751623;

    float xx = x * x;

    float u = xx + (x * xx - xx) * (a + xx * ((b - a) + (1.0 - b) * x));
    
    return c + (1.0 - c) * u;
}

float SliceRelInverseCDF0_Cos_Toe_B(float x, float k)
{
    float x2 = sqrt(x);
    float x3 = pow(x, 1.0/3.0);
    
    // inverse sinstep toe
    float a = x2 * (0.9003163161571062 + x * (0.07769284616641428 + (0.007045586828271703 + 0.014945250848207962 * x) * x));
    
    // inverse sinstep2 toe
    float b = x3 * (0.8471308576374195 + (0.13907161805849433 + 0.013797524304086095 * x) * x);
          b*= 1.0 + 0.03822 * (x2 * ((1.0 - x)*(1.0 - x)));
    
    float num = a * b;
    float den = b * (1.0 - k) + a * k;
    
    return max(0.0, num / den);// reciprocal mix + kill nan
    //return x == 0.0 ? 0.0 : num / den;// reciprocal mix + kill nan
}

float SliceRelInverseCDF0_Cos_B11(float x, float s)
{
    float u = x > 0.0 ? -1.0 : 1.0;
    
    return SliceRelInverseCDF0_Cos_Toe_B(x * u + 1.0, s) * u - u;
}
/////////////////////////////////////////////////////////////////////////////////

vec3 Eval_DistantLight(uint occBits, vec3 X, vec3 Y, float angN, float cosN, float sinN, float angJitter)
{
    float x0 = 0.5 + Pi025 * (sinN / (cosN + angN * sinN));

    vec2 s0 = vec2(0.5 + angN * RcpPi,
                   0.5 - angN * RcpPi);// used by approx Ref + B
    
    vec2 k0 = vec2(SliceRelInverseCDF0_Cos_B_kFromS(s0.x), 
                   SliceRelInverseCDF0_Cos_B_kFromS(s0.y));// used by approx B

    vec2 u0 = vec2(SliceRelInverseCDF0_Cos_A_uFromAngN( angN),
                   SliceRelInverseCDF0_Cos_A_uFromAngN(-angN));// used by approx A
                   
    vec2 u1 = mix(u0, u0*u0, 0.085);// used by approx A+

    float mS0 = 1.0 / (      0.5 * x0);
    float mS1 = 1.0 / (0.5 - 0.5 * x0);
    
    float mA0 = -1.0;
    float mA1 = -1.0 - x0 * mS1;
        
    float nS0 = Pi025 + angN * 0.5;
    float nS1 = Pi025 - angN * 0.5;
    
    #if 1
    // use X = WVec_from_VVec(smplDirVS) | Y = WVec_from_VVec(V)
    // fold [y -= angN] into [y = y * nS + nA]:
    float nA0 =-nS0;
    float nA1 = nS1;
    #else
    // use X = WVec_from_VVec(normalize(T)) | Y = WVec_from_VVec(normalize(projN))
    float nA0 =-nS1;
    float nA1 = nS0;
    #endif

#ifdef USE_REFERENCE_DISTANT_LIGHT_SAMPLING
    const uint bitsPerSector = 1u;// 1 2 4 8 -> dir count: 32 16 8 4
#else
    const uint bitsPerSector = 4u;// 1 2 4 8 -> dir count: 32 16 8 4
#endif

    // (partial) bit counting:
    if(bitsPerSector >= 2u)
    {
        // put count of each 2 bits into those 2 bits
        occBits -= (occBits >> 1u) & 0x55555555u;
        
        if(bitsPerSector >= 4u)
        {
            // put count of each 4 bits into those 4 bits
            occBits = (occBits & 0x33333333u) + ((occBits >> 2u) & 0x33333333u);
            
            if(bitsPerSector == 8u)
            {
                // put count of each 8 bits into those 8 bits
                occBits = (occBits + (occBits >> 4u)) & 0xF0F0F0Fu;
            }
        }
    }
    
    const uint count = 32u / bitsPerSector;
    
    const float rcpCount = 1.0 / float(count);
    
    const uint msk = ~((~0u) << bitsPerSector);    

    // flip angJitter so we get the correct result if we use all 32 directions:
    angJitter = rcpCount - angJitter * rcpCount;
    
    vec3 res = vec3(0.0);
    
    for(uint j = 0u; j < count; ++j)
    {
        uint occBits0 = (occBits >> (j * bitsPerSector)) & msk;
        
       // if(occBits0 == msk) continue;
        
        float vis0 = float(bitsPerSector) - float(occBits0);
        
        float x = clamp(float(j) * rcpCount + angJitter, 0.0, 1.0);
        
        float ang;
        {
            bool side = x < x0;

            float mA = side ? mA0 : mA1;
            float mS = side ? mS0 : mS1;

            float nA = side ? nA0 : nA1;
            float nS = side ? nS0 : nS1;
            
            float u  = side ? u0.x : u0.y;
            float uA = side ? u1.x : u1.y;

            x = x * mS + mA;
    
        #ifdef USE_REFERENCE_DISTANT_LIGHT_SAMPLING
            float y = SliceRelInverseCDF0_Cos_Ref11(x, side ? s0.x : s0.y);
        #else
            float y = InvSinstep11(x);
                  //y = SliceRelInverseCDF0_Cos_A11(x, u);
                  //y = SliceRelInverseCDF0_Cos_A11(x, mix(uA, u, x*x));
                  //y = SliceRelInverseCDF0_Cos_B11(x, side ? k0.x : k0.y);
                  //y = SliceRelInverseCDF0_Cos_Ref11(x, side ? s0.x : s0.y);
        #endif

            y = y * nS + nA;
            
            ang = y;
        }
        
        vec2 dir0 = vec2(sin(ang), cos(ang));

        vec3 dirW = dir0.x * X + dir0.y * Y;
        
        res += Eval_Sky(dirW) * vis0;
    }

    res *= 1.0/32.0;
    
    return res;
}

// ================================================================================================================ //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


vec4 GTVBAO(vec2 uv0, vec3 wpos, vec3 N, uint dirCount)
{
    vec3 positionVS = VPos_from_WPos(wpos);
    vec3 normalVS   = VVec_from_WVec(N);
    
    vec3 V = isPerspectiveCam ? -normalize(positionVS) : vec3(0.0, 0.0, -1.0);
    
    vec2 rayStart = SPos_from_VPos(positionVS).xy;

    uint frame = USE_TEMP_ACCU_COND ? uint(iFrame) : 0u;
        
    float ao = 0.0;
    vec3 gi = vec3(0.0);
    
    for(uint i = 0u; i < dirCount; ++i)
    {
        uint n = frame * dirCount + i;
        vec4 rnd01 = Rnd01x4(uv0, n);
        
        ////////////////////////////////////////////////// slice direction sampling
        vec3 smplDirVS;// view space sampling vector
        vec2 dir;// screen space sampling vector
        {
           #if GTVBAO_SLICE_SAMPLING_MODE == 1
            // sample slice dir uniformly and later compute slice_weight accordingly
            
            dir = vec2(cos(rnd01.x * Pi), sin(rnd01.x * Pi));

            smplDirVS = vec3(dir.xy, 0.0);

            if(isPerspectiveCam)
            {
                // set up View Vec Space -> View Space mapping
                vec4 Q_toV = GetQuaternion1(V);

                smplDirVS = Transform_Vz0Qz0(dir, Q_toV);

                vec3 rayStart = SPos_from_VPos(positionVS);
                vec3 rayEnd   = SPos_from_VPos(positionVS + smplDirVS*(nearZ*0.5));

                vec3 rayDir   = rayEnd - rayStart;

                rayDir /= length(rayDir.xy);

                dir = rayDir.xy;
            }
            
           #elif GTVBAO_SLICE_SAMPLING_MODE == 2
            // exact slice dir importance sampling via 2 rnd numbers
            // sample cos lobe in world space and project dir to screen space to be used as slice dir
            
            vec2 s = rnd01.xy * 2.0 - 1.0;

            vec3 cosDir;
            {
              #if 1
                // align up-axis of local sampling frame with view vector
                // -> results in better noise profile when looking straight at a surface
                vec3 sph;// = Sample_Sphere(s); inlined here to ensure z is up
                {
                    float ang = Pi * s.x;
                    float s1p = sqrt(1.0 - s.y*s.y);

                    sph = vec3(vec2(cos(ang), sin(ang)) * s1p, s.y);
                }

                if(isPerspectiveCam)
                {
                    sph = Transform_Qz0(sph, GetQuaternion1(V));
                }

                vec3 cosDirVS = normalize(sph + VVec_from_WVec(N));
                     cosDir   = WVec_from_VVec(cosDirVS);

                smplDirVS = cosDirVS;
                
              #else
              
                cosDir = normalize(Sample_Sphere(s) + N);

                smplDirVS = VVec_from_WVec(cosDir);
                
              #endif
            }
            
            vec3 rayDir = smplDirVS;
            
            if(isPerspectiveCam)
            {
                rayDir = SPos_from_WPos(wpos + cosDir * (nearZ * 0.5)) - SPos_from_WPos(wpos);
            }
            
            // 1 px step size
            rayDir /= length(rayDir.xy);

            dir = rayDir.xy;

            // make orthogonal to V (alternatively use sliceN = normalize(sliceN);)
            smplDirVS = normalize(smplDirVS - V * dot(V, smplDirVS));

           #elif GTVBAO_SLICE_SAMPLING_MODE == 3
            // approximate slice dir importance sampling via 1 rnd number
            
            // set up View Vec Space <-> View Space mapping
            vec4   Q_toV = GetQuaternion1(V);
            vec4 Q_fromV = Q_toV * vec4(vec3(-1.0), 1.0);// conjugate

            vec3 normalVVS = normalVS;

            if(isPerspectiveCam) normalVVS = Transform_Qz0(normalVS, Q_fromV);

            dir = SampleSliceDir(normalVVS, rnd01.x);

            smplDirVS = vec3(dir.xy, 0.0);

            if(isPerspectiveCam)
            {
                smplDirVS = Transform_Vz0Qz0(dir, Q_toV);

                vec3 rayStart = SPos_from_VPos(positionVS);
                vec3 rayEnd   = SPos_from_VPos(positionVS + smplDirVS*(nearZ*0.5));

                vec3 rayDir   = rayEnd - rayStart;

                rayDir /= length(rayDir.xy);

                dir = rayDir.xy;
            }
           #endif
        }
        //////////////////////////////////////////////////
        
        ////////////////////////////////////////////////// construct slice
        vec3 sliceN, projN, T;
        float cosN, sinN, angN, projNRcpLen;
        {
            sliceN = cross(V, smplDirVS);

            projN = normalVS - sliceN * dot(normalVS, sliceN);

            float projNSqrLen = dot(projN, projN);
               if(projNSqrLen == 0.0) return vec4(0.0, 0.0, 0.0, 1.0);

            projNRcpLen = inversesqrt(projNSqrLen);

            cosN = dot(projN, V) * projNRcpLen;

            T = cross(sliceN, projN);
            
            float sgn = dot(V, T) < 0.0 ? -1.0 : 1.0;
            
            angN = sgn * ACos(cosN);
            
            sinN = sqrt(max(0.0, 1.0 - cosN*cosN)) * sgn;
        }
        //////////////////////////////////////////////////

        vec4 mapN0 = SliceRelCDF_Cos_Map(angN, cosN, sinN);
        vec2 mapN  = mapN0.xz;
        
        float angOff = angN * RcpPi + 0.5;

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
                
                vec4 buff = textureLod(iChannel2, samplePos / Resolution.xy, 0.0);
                
                //vec3  sampleRad   = buff.rgb;
                float sampleDepth = buff.w;
                
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

                // project samples onto unit circle and compute angles relative to V
                vec2 horCos = vec2(dot(normalize(deltaPosFront), V), 
                                   dot(normalize(deltaPosBack ), V));

                vec2 horAng = ACos(horCos) * d;

                // shift relative angles from V to N + map to [0,1]
                vec2 hor01 = clamp(horAng * RcpPi + angOff, 0.0, 1.0);

                // sampling direction flips min/max angles
                hor01 = d >= 0.0 ? hor01.xy : hor01.yx;
                {
                #if 1
                    // map to slice relative distribution (optimized)
                    hor01.x = SliceRelCDF_Cos(hor01.x * Pi2 - Pi, angN, sinN, mapN);
                    hor01.y = SliceRelCDF_Cos(hor01.y * Pi2 - Pi, angN, sinN, mapN);
                #else
                    // map to slice relative distribution (old)
                    hor01.x = SliceRelCDF_Cos(hor01.x, angN, cosN, d > 0.0);
                    hor01.y = SliceRelCDF_Cos(hor01.y, angN, cosN, d > 0.0);
                #endif
                    // jitter sample locations + clamp01
                    hor01 = clamp(hor01 + rnd01.w * (1.0/32.0), 0.0, 1.0);
                }
               
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
            
            mapN  = mapN0.yw;
        }
        
        float occ0 = float(CountBits(occBits)) * (1.0/32.0);

        float slice_weight = 1.0;
        
       #if GTVBAO_SLICE_SAMPLING_MODE == 1
        {
            // if we sample the cos slice dir from a uniform distribution we need to account for that here
            slice_weight = max(0.0, 1.0/projNRcpLen * (cosN + angN * sinN));
        }
       #endif
        
        vec3 gi0 = vec3(0.0);
        {
            vec3 X = WVec_from_VVec(smplDirVS);
            vec3 Y = WVec_from_VVec(V);

            gi0 = Eval_DistantLight(occBits, X, Y, angN, cosN, sinN, rnd01.w);
        }
        
        ao += slice_weight - slice_weight * occ0;
        gi +=                slice_weight * gi0;
    }
    
    float norm = 1.0 / float(dirCount);
    
    return vec4(gi, ao) * norm;
}

//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////


vec3 Read_Albedo(vec2 uv0)
{
    // in a practical setting we would do a buffer read here, but because of shadertoy's
    // limitations it is easier and cleaner to just re-render the scene here once to get the albedo
    vec4 mouseAccu = ReadVar4(1, VAR_ROW);

    uvec2 uv = uvec2(uv0.xy - 0.5);
    vec2 tex = uv0.xy / iResolution.xy;
    vec2 tex21 = tex * 2.0 - vec2(1.0);

    PrepareCam(mouseAccu, USE_PERSPECTIVE_CAM_COND);

    vec3 rp, rd;
    GetRay(uv0, /*out*/ rp, rd);

    float t; vec3 N, a;
    Intersect_Scene(rp, rd, /*out:*/ t, N, a);
    
    return a;
}

void mainImage(out vec4 outCol, in vec2 uv0)
{     
    Resolution = iResolution.xy;
    isLeft = uv0.x < iResolution.x * 0.5;
    
    vec4 mouseAccu  = ReadVar4(1, VAR_ROW);
    float frameAccu = ReadVar (3, VAR_ROW);

    vec3 a    = Read_Albedo(uv0);
    vec3 N    = textureLod(iChannel3, uv0 / iResolution.xy, 0.0).xyz;
    vec4 buff = textureLod(iChannel2, uv0 / iResolution.xy, 0.0);
    //vec3 rad  = buff.rgb;
  float depth = buff.w;
    
    if(depth >= exp2(10.0))
    {
        outCol = vec4(0.0);
        
        return;
    }
    
    vec3 spos = vec3(uv0, depth);
    
    vec3 wpos = WPos_from_SPos(spos);
         wpos += N * (1.0/1024.0);
    
    vec3 col = vec3(0.0);

    vec3 sky;
    {
        uint count = 1u;
        
        sky = GTVBAO(uv0, wpos, N, count).rgb;
    }
    
    col = sky;
    
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
