// Shadertoy wc2SzR — GT-VBAO [Distant Light Sampling]
// Author: TinyTexel (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Common
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

 // affects both GT-VBGI and the reference GI (if USE_ANALYTICAL_RAYCASTING is not active in Buffer D)
 //#define USE_BACKFACE_REJECTION

const float Raymarching_SampleCount = 32.0;
const float Raymarching_Width = 512.0;
const float Thickness = 0.5;

//==================================================================================//
//////////////////////////////////////////////////////////////////////////////////////

vec2 Resolution;

#define USE_TEMP_ACCU_COND                (ReadKeyToggle(KEY_TAB  ) != 0.0)
#define USE_PERSPECTIVE_CAM_COND          (ReadKeyToggle(KEY_CTRL ) == 0.0)
#define SHOW_UI_COND                      (ReadKeyToggle(KEY_U    ) == 0.0)

////////////////////////////////////////////////////////////////////////////////////////////////////////////// misc
//==========================================================================================================//
#define VAR_ROW 4

/* http://keycode.info/ */
#define KEY_LEFT  37
#define KEY_UP    38
#define KEY_RIGHT 39
#define KEY_DOWN  40

#define KEY_TAB 9
#define KEY_CTRL 17
#define KEY_ALT 18
#define KEY_SHIFT 16
#define KEY_SPACE 32 

#define KEY_Q 81
#define KEY_W 87
#define KEY_E 69
#define KEY_R 82
#define KEY_T 84

#define KEY_A 65
#define KEY_S 83
#define KEY_D 68
#define KEY_F 70
#define KEY_G 71

#define KEY_N1 49
#define KEY_N2 50
#define KEY_N3 51
#define KEY_N4 52
#define KEY_N5 53
#define KEY_N6 54
#define KEY_N7 55
#define KEY_N8 56

#define KEY_M 77
#define KEY_N 78
#define KEY_O 79
#define KEY_U 85

#define clamp01(x) clamp(x, 0.0, 1.0)
#define If(cond, resT, resF) mix(resF, resT, cond)

const float Pi = 3.14159265359;
const float RcpPi = 1.0 / Pi;
const float Pi05 = Pi * 0.5;
const float Pi2  = Pi * 2.0;
const float Pi025= Pi * 0.25;
const float RcpPi05 = 1.0 / Pi05;

float Pow2(float x) {return x*x;}
float Pow3(float x) {return x*x*x;}
float Pow4(float x) {return Pow2(Pow2(x));}

//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

vec3 Eval_Sky(vec3 dir)
{
#if 1
    float hor = sin(dir.x*8.0) * 0.5 + 0.5;
          hor = smoothstep(-0.1, 0.1, dir.y - (hor*0.75-0.3));
    
    float sun = dot(dir, normalize(vec3(-1.0, 0.5, 1.0)));
          sun = smoothstep(0.85, 0.9, sun);
    
    vec3 sky = mix(vec3(1.0 , 0.2 , 0.1) * 0.1, 
               mix(vec3(0.01, 0.45, 1.0) * 1., 
                   vec3(1.0 , 0.5 , 0.1) * 8.0, sun), hor);
    
    return sky;
#else
    vec3 colA = vec3(1.0, 0.0, 0.0) * 32.0;
    vec3 colB = vec3(0.05, 0.4, 1.0);
    
    vec3 D = normalize(vec3(-1.0, 0.0, -1.0));
   // D = vec3(0.0, 1.0, 0.0);
    return dot(dir, D) > 0.95 ? colA : colB;
 #endif
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////// camera logic + transforms
//==========================================================================================================//
bool isPerspectiveCam;// ortho/proj cam toggle
float cdist, nearZ;// camera dist from origin + z-near
mat3 cmat;// camera matrix
vec3 cpos;// camera pos
mat4 pmat, ipmat;// proj matrix + inverse

void PrepareCam(vec4 mouseAccu, bool isPerspectiveCam0)
{
    isPerspectiveCam = isPerspectiveCam0;
    
    vec2 ang = vec2(Pi * 0.25, Pi * -0.1);
   // ang = vec2(Pi05, Pi * -0.5);// start top-down
    //ang.y = 0.0;
    ang += mouseAccu.xy * 0.008;
    
    vec3 front, right, up;
    {
        float sinPhi   = sin(ang.x);
        float cosPhi   = cos(ang.x);
        float sinTheta = sin(ang.y);
        float cosTheta = cos(ang.y);    

        front = vec3(cosPhi * cosTheta, 
                              sinTheta, 
                     sinPhi * cosTheta);

        right = vec3(-sinPhi, 0.0, cosPhi);
        
        up    = vec3(-cosPhi * sinTheta,
                               cosTheta,
                     -sinPhi * sinTheta);
        
    }

    cmat = mat3(right, up, front);
    
    cdist = exp2(1.5 + mouseAccu.w * 0.02);
    //cdist = exp2(2.0 + mouseAccu.w * 0.02);

    float aspect = Resolution.x / Resolution.y;

    vec2 vpSize = vec2(1.0, 1.0 / aspect) * 2.0;// viewport size at focal length

    if(!isPerspectiveCam) vpSize *= cdist;

    nearZ = isPerspectiveCam ? 0.125 : 0.0;

   #if 1
    float focalLen = 0.8;// = cot(fov * 0.5) for w == 2

    float w = vpSize.x;
    float h = vpSize.y;

    float m00 = 2.0 * focalLen / w;
    float m11 = 2.0 * focalLen / h;
   #else 

    float fovX = 0.570447 * Pi;// 2 * arccot(focalLen) fpr w == 2
    float m00 = cos(fovX * 0.5) / sin(fovX * 0.5);
    float m11 = m00 * aspect;
   #endif
    
    
    float m23 = -nearZ;
    float m32 = 1.0;
    
    float m33 = 0.0;
    
    if(!isPerspectiveCam)
    {
        m00 = 2.0 / vpSize.x;
        m11 = 2.0 / vpSize.y;
    
        m23 = m32 = 0.0;
        m33 = 1.0;
    }    
    
    pmat = mat4(m00, 0.0, 0.0, 0.0,
                0.0, m11, 0.0, 0.0,
                0.0, 0.0, 1.0, m32,
                0.0, 0.0, m23, m33);
    
    float i00 = 1.0 / m00;
    float i11 = 1.0 / m11;
    
    float i22 = 0.0;
    
    float i23 = 1.0;
    float i32 =-1.0/nearZ;
    
    float i33 = 1.0/nearZ;
    
    if(!isPerspectiveCam)
    {
        i22 = i33 = 1.0;
        i23 = i32 = 0.0;
    }
                
    ipmat = mat4(i00, 0.0, 0.0, 0.0,
                 0.0, i11, 0.0, 0.0,
                 0.0, 0.0, i22, i32,
                 0.0, 0.0, i23, i33);
    
    
    if(isPerspectiveCam)
    {
        cpos = -front * cdist;
    }
    else
    {
        cpos = -front * 8.0;
    }    
}

float LinDepth_from_NonLinDepth(float depth)
{
    if(!isPerspectiveCam) return depth;
    
    //1.0 / (-depth/nearZ + 1.0/nearZ);
    //1.0 / ((-depth + 1.0)/nearZ);
    //nearZ / (-depth + 1.0);
    return nearZ / (1.0 - depth);
}

float NonLinDepth_from_LinDepth(float depth)
{
    if(!isPerspectiveCam) return depth;

    //return (depth - n) / depth;
    return 1.0 - nearZ / depth;
}


// ====== View <-> World ====== //
vec3 VPos_from_WPos(vec3 wpos)
{
    return (wpos - cpos) * cmat;
}

vec3 VVec_from_WVec(vec3 wvec)
{
    return wvec * cmat;
}

////

vec3 WPos_from_VPos(vec3 vpos)
{
    return cmat * vpos + cpos;
}

vec3 WVec_from_VVec(vec3 vvec)
{
    return cmat * vvec;
}
// =========================== //

// ====== Proj <-> View ====== //
vec4 PPos_from_VPos(vec3 vpos)
{
    return pmat * vec4(vpos, 1.0);
}

vec3 VPos_from_PPos(vec4 ppos)
{
    vec4 vpos = ipmat * ppos;
    
    return vpos.xyz / vpos.w;
}

vec4 PVec_from_VVec(vec3 vvec)
{
    return pmat * vec4(vvec, 0.0);
}
// =========================== //


// ====== Screen <-> View ====== //
vec3 SPos_from_VPos(vec3 vpos)
{
    vec4 ppos = PPos_from_VPos(vpos);
    
    vec2 tc21 = ppos.xy / ppos.w;
    
    vec2 uv0 = (tc21 * 0.5 + 0.5) * Resolution;
    
    return vec3(uv0, vpos.z);
}

vec3 SVec_from_VVec_Ortho(vec3 vvec)
{
    vec4 pvec = PVec_from_VVec(vvec);
    
    vec2 xy = (pvec.xy * 0.5) * Resolution;
    
    return vec3(xy, vvec.z);
}
////

vec3 VPos_from_SPos(vec3 spos)
{
    vec2 uv0 = spos.xy;
    float depth = spos.z;
          depth = NonLinDepth_from_LinDepth(depth);
    
    vec2 tc21 = uv0 / Resolution * 2.0 - 1.0;
    
    vec3 ppos = vec3(tc21, depth);
    
    vec4 vpos = ipmat * vec4(ppos, 1.0); 
    
    vpos /= vpos.w;
    
    return vpos.xyz;  
}
// ============================= //

// ====== Proj <-> World ====== //
vec4 PPos_from_WPos(vec3 wpos)
{
    vec3 vpos = VPos_from_WPos(wpos);
    
    return PPos_from_VPos(vpos);
}

vec3 WPos_from_PPos(vec4 ppos)
{
    vec3 vpos = VPos_from_PPos(ppos);
    
    return WPos_from_VPos(vpos);
}

vec4 PVec_from_WVec(vec3 wvec)
{
    vec3 vvec = VVec_from_WVec(wvec);
    
    return PVec_from_VVec(vvec);
}
// =========================== //

// ====== Screen <-> World ====== //
vec3 SPos_from_WPos(vec3 wpos)
{
    vec3 vpos = VPos_from_WPos(wpos);

    return SPos_from_VPos(vpos);
}

////

vec3 WPos_from_SPos(vec3 spos)
{
    vec3 vpos = VPos_from_SPos(spos);

    return WPos_from_VPos(vpos);
}
// ============================== //

void GetRay(vec2 uv0, out vec3 rp, out vec3 rd)
{
    vec3 spos = vec3(uv0, nearZ);
    
    vec3 vpos = VPos_from_SPos(spos); 

    if(isPerspectiveCam)
    {
        rp = cpos;
        rd = WVec_from_VVec(normalize(vpos)); 
    }
    else
    {
        rp = WPos_from_VPos(vpos); 
        rd = cmat[2];
    }
}
//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////////////////////// intersection routines
//==========================================================================================================//
/*
IN:
	rp		: ray start position
	rd		: ray direction (normalized)
	
	cp		: cube position
	cth		: cube thickness (cth = 0.5 -> unit cube)
	
OUT:
	t		: distances to intersection points (negative if in backwards direction)

EXAMPLE:	
	vec2 t;
	float hit = Intersect_Ray_Cube(pos, dir, vec3(0.0), vec3(0.5), OUT t);
*/
float Intersect_Ray_Cube(
vec3 rp, vec3 rd, 
vec3 cp, vec3 cth, 
out vec2 t)
{	
	rp -= cp;
	
	vec3 m = 1.0 / -rd;
	vec3 o = If(lessThan(rd, vec3(0.0)), -cth, cth);
	
	vec3 uf = (rp + o) * m;
	vec3 ub = (rp - o) * m;
	
	t.x = max(uf.x, max(uf.y, uf.z));
	t.y = min(ub.x, min(ub.y, ub.z));
	
	// if(ray start == inside cube) 
	if(t.x < 0.0 && t.y > 0.0) {t.xy = t.yx;  return 1.0;}
	
	return t.y < t.x ? 0.0 : (t.x > 0.0 ? 1.0 : -1.0);
}

/*
[...]

OUT:
	n0 : normal for t.x
	n1 : normal for t.y

EXAMPLE:	
	vec2 t; vec3 n0, n1;
	float hit = Intersect_Ray_Cube(pos, dir, vec3(0.0), vec3(0.5), OUT t, n0, n1);
*/
float Intersect_Ray_Cube(
vec3 rp, vec3 rd, 
vec3 cp, vec3 cth, 
out vec2 t, out vec3 n0, out vec3 n1)
{	
	rp -= cp;
	
	vec3 m = 1.0 / -rd;
    vec3 os = If(lessThan(rd, vec3(0.0)), vec3(1.0), vec3(-1.0));
    //vec3 os = sign(-rd);
	vec3 o = -cth * os;
	
    
	vec3 uf = (rp + o) * m;
	vec3 ub = (rp - o) * m;
	
	//t.x = max(uf.x, max(uf.y, uf.z));
	//t.y = min(ub.x, min(ub.y, ub.z));
	
    if(uf.x > uf.y) {t.x = uf.x; n0 = vec3(os.x, 0.0, 0.0);} else 
                    {t.x = uf.y; n0 = vec3(0.0, os.y, 0.0);}
    if(uf.z > t.x ) {t.x = uf.z; n0 = vec3(0.0, 0.0, os.z);}
    
    if(ub.x < ub.y) {t.y = ub.x; n1 = vec3(os.x, 0.0, 0.0);} else 
                    {t.y = ub.y; n1 = vec3(0.0, os.y, 0.0);}
    if(ub.z < t.y ) {t.y = ub.z; n1 = vec3(0.0, 0.0, os.z);}
    
    
	// if(ray start == inside cube) 
	if(t.x < 0.0 && t.y > 0.0) 
    {
        t.xy = t.yx;  
        
        vec3 n00 = n0;
        n0 = n1;
        n1 = n00;
        
        return 1.0;
    }
	
	return t.y < t.x ? 0.0 : (t.x > 0.0 ? 1.0 : -1.0);
}

/*
IN:
	rp		: ray start position
	rd		: ray direction (normalized)
	
	sp2		: sphere position
	sr2		: sphere radius squared
	
OUT:
	t		: distances to intersection points (negative if in backwards direction)

EXAMPLE:	
	vec2 t;
	float hit = Intersect_Ray_Sphere(pos, dir, vec3(0.0), 1.0, OUT t);
*/
float Intersect_Ray_Sphere(
vec3 rp, vec3 rd, 
vec3 sp, float sr2, 
out vec2 t)
{	
	rp -= sp;
	
	float a = dot(rd, rd);
	float b = 2.0 * dot(rp, rd);
	float c = dot(rp, rp) - sr2;
	
	float D = b*b - 4.0*a*c;
	
	if(D < 0.0) return 0.0;
	
	float sqrtD = sqrt(D);
	// t = (-b + (c < 0.0 ? sqrtD : -sqrtD)) / a * 0.5;
	t = (-b + vec2(-sqrtD, sqrtD)) / a * 0.5;
	
	// if(start == inside) ...
	if(c < 0.0) t.xy = t.yx;

	// t.x > 0.0 || start == inside ? infront : behind
	return t.x > 0.0 || c < 0.0 ? 1.0 : -1.0;
}

bvec2 minmask(vec2 v)
{
    bool x = v.x < v.y || isnan(v.y);
    
    return bvec2(x, !x);
}


bvec2 maxmask(vec2 v)
{
    bool x = v.x >= v.y || isnan(v.y);
    
    return bvec2(x, !x);
}


bvec3 minmask(vec3 v)
{    
    return bvec3(v.x <= v.y && v.x <= v.z,
                 v.y <  v.z && v.y <  v.x,
                 v.z <  v.x && v.z <= v.y);
}

bvec3 maxmask(vec3 v)
{
    return bvec3(v.x >= v.y && v.x >= v.z,
                 v.y >  v.z && v.y >  v.x,
                 v.z >  v.x && v.z >= v.y);
}

bvec3 minmask2(vec3 v)
{
    bool x = !(v.x >  v.y || v.x >  v.z) && !isnan(v.x);
    bool y = !(v.y >= v.z || v.y >= v.x) && !isnan(v.y);
    
    return bvec3(x, y, !(x || y));
}

bvec3 maxmask2(vec3 v)
{
    bool x = !(v.x <  v.y || v.x <  v.z) && !isnan(v.x);
    bool y = !(v.y <= v.z || v.y <= v.x) && !isnan(v.y);
    
    return bvec3(x, y, !(x || y));
}

void Intersect_Ray_CubeBackside(
vec3 rp, vec3 rd, 
vec3 cp, vec3 cth, 
out float t, out vec3 N)
{	
	rp -= cp;
	
	vec3 m = 1.0 / -rd;
    vec3 os = If(lessThan(rd, vec3(0.0)), vec3(1.0), vec3(-1.0));
	vec3 o = -cth * os;
	
	vec3 ub = (rp - o) * m;
	
    bvec3 mb = minmask2(ub);
    
    N = os * vec3(mb);
    
    t = mb.x ? ub.x : mb.y ? ub.y : ub.z;
}

bool IsInsideCube(vec3 p, vec3 cp, vec3 cd)
{
    vec3 b = abs(p - cp);
    
    return b.x < cd.x && b.y < cd.y && b.z < cd.z;
}
//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////////////////////// ACEScg
//==========================================================================================================//

// ACES fit by Stephen Hill (@self_shadow) | MIT license
// https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl 

// sRGB => XYZ => D65_2_D60 => AP1
const mat3 sRGBtoAP1 = mat3
(
	0.613097, 0.339523, 0.047379,
	0.070194, 0.916354, 0.013452,
	0.020616, 0.109570, 0.869815
);

const mat3 AP1toSRGB = mat3
(
     1.704859, -0.621715, -0.083299,
    -0.130078,  1.140734, -0.010560,
    -0.023964, -0.128975,  1.153013
);

// AP1 => RRT_SAT
const mat3 RRT_SAT = mat3
(
	0.970889, 0.026963, 0.002148,
	0.010889, 0.986963, 0.002148,
	0.010889, 0.026963, 0.962148
);


// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
const mat3 ACESInputMat = mat3
(
    0.59719, 0.35458, 0.04823,
    0.07600, 0.90834, 0.01566,
    0.02840, 0.13383, 0.83777
);

// ODT_SAT => XYZ => D60_2_D65 => sRGB
const mat3 ACESOutputMat = mat3
(
     1.60475, -0.53108, -0.07367,
    -0.10208,  1.10813, -0.00605,
    -0.00327, -0.07276,  1.07602
);

vec3 ToneTF(vec3 x)
{
    vec3 a = (x            + 0.0822192) * x;
    vec3 b = (x * 0.983521 + 0.5001330) * x + 0.274064;
    
    return a / b;
}

vec3 Tonemap(vec3 acescg)
{
    vec3 color = acescg * RRT_SAT;
    
    color = ToneTF(color);
    
    color = color * ACESOutputMat;

    return color;
}

//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////////////////////// scene intersection
//==========================================================================================================//
bool Intersect_Ray_Cube(vec3 rp, vec3 rd, vec3 c0p, vec3 c0d, 
                        inout float hit, inout float t, inout vec3 n)
{
    vec2 tt; vec3 n0, n1;
    float th = Intersect_Ray_Cube(rp, rd, c0p, c0d, /*out:*/ tt, n0, n1);

    if(th > 0.0)
    if(hit <= 0.0 || tt.x < t)
    {
        t = tt.x;
        n = n0;

        hit = 1.0;
        
        return true;
    }
    
    return false;
}

bool Intersect_Ray_Plate(vec3 rp, vec3 rd, vec3 c0p, vec3 c0d, float c1p_y, float c1dxz, float c1dy, float c1ps,
                        inout float hit, inout float t, inout vec3 n, inout vec3 a)
{
    vec3 c1p = vec3(0.0, c1p_y, 0.0);
    vec3 c1d = vec3(c1dxz, c1dy, c1dxz);

    //c1p.y = 0.0;// remove tile pattern

    c1p.xz = (floor(rp.xz*c1ps+0.5))/c1ps;

    bool isInsideC0 = IsInsideCube(rp, c0p, c0d);
    bool isInsideC1 = IsInsideCube(rp, c1p, c1d);

    if(isInsideC0 && isInsideC1)
    {
        float t0; vec3 n0;
        Intersect_Ray_CubeBackside(rp, rd, c1p, c1d, t0, n0);

        if(IsInsideCube(rp+rd*t0, c0p, c0d))
        {
            if(hit <= 0.0 || t0 < t)
            {
                hit = 1.0;
                t = t0;
                n = n0;
                a = vec3(1.0, 1.0, 1.0);
            
                return true;
            }
        }
    }
    else
    {
        vec2 tt; vec3 n0, n1;
        float th = Intersect_Ray_Cube(rp, rd, c0p, c0d, /*out:*/ tt, n0, n1);

        bool hit0 = th > 0.0;
        if ( hit0 )
        {
            c1p.xz = (floor((rp.xz+rd.xz*tt.x)*c1ps+0.5))/c1ps;
            
            if(IsInsideCube(rp+rd*tt.x, c1p, c1d))
            {
                float t0; vec3 n0;
                Intersect_Ray_CubeBackside(rp, rd, c1p, c1d, t0, n0);

                if(IsInsideCube(rp+rd*t0, c0p, c0d))
                {
                    if(hit <= 0.0 || t0 < t)
                    {
                        hit = 1.0;
                        t = t0;
                        n = n0;
                        a = vec3(1.0, 1.0, 1.0);
                        
                        if(n0.y != 0.0) a = vec3(.0, 1.0, 1.0);

                        return true;
                    }
                }
            }
            else
            {
                if(hit <= 0.0 || tt.x < t)
                {
                    hit = 1.0;
                    t = tt.x;
                    n = n0;
                    a = vec3(1.0, 1.0, 1.0);

                    return true;
                }
            }

        }        
    }
    
    return false;
}

vec3 TransA(vec3 u, bool foo)
{
    if(foo)
    {
        u.xy = u.yx;
        u.x *= -1.0;
    }
    else
    {
        u.x *= -1.0;
        u.xy = u.yx;
    }
    
    return u;
}

vec3 TransB(vec3 u, bool foo)
{
    if(foo)
    {
        u.zy = u.yz;
        u.z *= -1.0;
    }
    else
    {
        u.z *= -1.0;
        u.zy = u.yz;
    }
    
    return u;
}


bool Intersect_Ray_Plates(vec3 rp, vec3 rd, vec3 c0p, vec3 c0d, float c1p_y, float c1dxz, float c1dy, float c1ps,
                         inout float hit, inout float t, inout vec3 n, inout vec3 a)
{
    bool hit0 = false;
    
    rp.x += exp2(-18.0);
    //if(false)
    if(Intersect_Ray_Plate(TransA(rp, false), TransA(rd, false), c0p, c0d, c1p_y, c1dxz, c1dy, c1ps, /*inout*/ hit, t, n, a))
    {
        n = TransA(n, true);
        //a = vec3(1.0, 0.0, 0.0);
        a = a.x == 0.0 ? vec3(1., 0.125, 0.) : vec3(1.0, 0., 0.);
        
        hit0 = true;
    }
    //if(false)
    if(Intersect_Ray_Plate(TransB(rp, false), TransB(rd, false), c0p, c0d, c1p_y, c1dxz, c1dy, c1ps, /*inout*/ hit, t, n, a))
    {
        n = TransB(n, true);
        //a = vec3(0.0, 1.0, 0.0);
        a = a.x == 0.0 ? vec3(0., 1., 0.25) : vec3(.0, 1., 0.);
        hit0 = true;
    }
    
    return hit0;
}

float Intersect_Scene(
vec3 rp, vec3 rd,
out float t, out vec3 n, out vec3 a)
{
    float hit = 0.0;

    float c1dxz = 0.4;
    float c1ps = 0.85;

    a = vec3(1.0);
    
    // ground plate thingy:
    //if(false)
    {
        if(Intersect_Ray_Plate(rp, rd, vec3(0.0, -0.8, 0.0), vec3(2.0, 0.125*1.2, 2.0), -0.64, c1dxz,  0.125, c1ps, /*inout*/ hit, t, n, a))
        {
            //a = vec3(1.0, 0.0, 0.0);
            //a = vec3(1.0);
            //a = vec3(0.0, 0.5, 1.);
            a = a.x == 0.0 ? vec3(.25, 1.0, .25) : vec3(0.0, 0.5, 1.);
            
        }
        
        if(Intersect_Ray_Plates(rp, rd, vec3(0.0, -2., 0.0), vec3(2.0, 0.15, 2.0), -1.9, 0.18,  0.125, 2., /*inout*/ hit, t, n, a))
        {
            //a = vec3(0.0, 1.0, 0.);
            //a = vec3(1.0);
        }
    }
    
    // slim pillars:
    //if(false)
    {
        float t0 = t;
        
        float r = 0.125*2.;
        float u = 1.0/c1ps;
        float l = 0.4;
        float h = 1.0;
        
        vec3 c0p = vec3(c1dxz, l, c1dxz);
         c0p = vec3(u - c1dxz, l, u - c1dxz);
         c0p = vec3(u - c1dxz, l, c1dxz);
        vec3 c0d = vec3(r, h, r);
        
        vec3 pa = vec3(u - c1dxz, l,     c1dxz);
        vec3 pb = vec3(u - c1dxz, l, u - c1dxz);
        vec3 pc = vec3(    c1dxz, l, u - c1dxz);
        
        //Intersect_Ray_Cube(rp, rd, pa, c0d, /*inout*/ hit, t, n);
        //Intersect_Ray_Cube(rp, rd, pb, c0d, /*inout*/ hit, t, n);
        //Intersect_Ray_Cube(rp, rd, pc, c0d, /*inout*/ hit, t, n);
        
        pa = vec3(-pa.z, pa.y, pa.x);
        pb = vec3(-pb.z, pb.y, pb.x);
        pc = vec3(-pc.z, pc.y, pc.x);
        
        //Intersect_Ray_Cube(rp, rd, pa, c0d, /*inout*/ hit, t, n);
        Intersect_Ray_Cube(rp, rd, pb, c0d, /*inout*/ hit, t, n);
        //Intersect_Ray_Cube(rp, rd, pc, c0d, /*inout*/ hit, t, n);
        
        pa = vec3(-pa.z, pa.y, pa.x);
        pb = vec3(-pb.z, pb.y, pb.x);
        pc = vec3(-pc.z, pc.y, pc.x);
        
        #if 0
        Intersect_Ray_Cube(rp, rd, pa, c0d, /*inout*/ hit, t, n);
        Intersect_Ray_Cube(rp, rd, pb, c0d, /*inout*/ hit, t, n);
        Intersect_Ray_Cube(rp, rd, pc, c0d, /*inout*/ hit, t, n);
        #endif
        
        pa = vec3(-pa.z, pa.y, pa.x);
        pb = vec3(-pb.z, pb.y, pb.x);
        pc = vec3(-pc.z, pc.y, pc.x);
        
        //Intersect_Ray_Cube(rp, rd, pa, c0d, /*inout*/ hit, t, n);
        Intersect_Ray_Cube(rp, rd, pb, c0d, /*inout*/ hit, t, n);
        //Intersect_Ray_Cube(rp, rd, pc, c0d, /*inout*/ hit, t, n);
        
        if(t < t0)
        {
            a = vec3(0., 0.5, 1.0);
            a = vec3(1.0);
        }
    }
    
    // top sphere:
    //if(false)
    {
        vec2 tt;
		float th = Intersect_Ray_Sphere(rp, rd, vec3(0.0), 0.5, /*out:*/ tt);
        
        //float hit0 = 0.0; th = Intersect_Ray_Cube(rp, rd, vec3(0.0), vec3(0.5, 1.0, 0.5), /*inout*/ hit0, tt.x, n) ? 1.0 : 0.0;
        
        if(th > 0.0)
        if(hit <= 0.0 || tt.x < t)
        {
            t = tt.x;
            n = normalize(rp + rd * tt.x);
            a = vec3(1.0, 1., 1.0);
            
            hit = 1.0;
        }
    }
    
    // bottom sphere:
    //if(false)
    {
        vec2 tt;
		float th = Intersect_Ray_Sphere(rp, rd, vec3(0.0, -2.25, 0.0), 2.0, /*out:*/ tt);
        
        if(th > 0.0)
        if(hit <= 0.0 || tt.x < t)
        {
            t = tt.x;
            n = normalize(rp + rd * tt.x - vec3(0.0, -2.25, 0.0));
            a = vec3(1.0);
            
            hit = 1.0;
        }
    }
    
    a = a * sRGBtoAP1;
    
    if(hit <= 0.0)
    {
        t = exp2(20.0);
        n = vec3(0.0);
        a = vec3(0.0);
    }
    
    return hit;
}
//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////////////////////// scene lighting
//==========================================================================================================//

float Eval_SpotLight(vec3 wpos, vec3 N, vec3 Lpos, vec3 Ldir, float Lap)
{
    vec3 Lvec = Lpos - wpos;
    
    vec3 L = normalize(Lvec);

    float NoL = clamp(dot(N, L), 0.0, 1.0);
    
    float LoD = -dot(L, Ldir);
    
    float sh0 = LoD > Lap ? 1.0 : 0.0;
    sh0 = smoothstep(Lap*0.9, Lap, LoD);
    sh0 *= mix(min((cos(LoD * 10.0 + cos(LoD*36.0)) * 0.5 + 0.5) * 2.0, 1.0), 1.0, LoD) * 1.0;
    
    float rad = NoL * RcpPi * sh0;
    rad /= dot(Lvec, Lvec);
    
    float sh;
    {
        vec3 p = wpos + N * 0.001;
        
        float t0; vec3 N0; vec3 a0;
        sh = 1.0 - Intersect_Scene(p, L, /*out:*/ t0, N0, a0);    
    }
    
    rad *= sh;
    
    return rad;
}

vec3 Eval_Lighting(vec3 wpos, vec3 N, vec3 a)
{
    vec3 rad;
    
    #if 1
    
    rad = a * Eval_SpotLight(wpos, N, vec3(-0.25, 2.65, -0.25), normalize(vec3( 0., -1., 0.0)), 0.4) * 16.0;
    
    #elif 0
    #else
    #endif
    
    return rad;
}

//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

// C. Schlick. "Fast alternatives to Perlin’s bias and gain function"
// inverse(Bias(x,s)) =   Bias(x  ,1-s)
// inverse(Bias(x,s)) = 1-Bias(1-x,  s)
float Bias(float x, float s)
{
    if(s == 0.0) return x != 1.0 ? 0.0 : 1.0;
    if(s == 1.0) return x != 0.0 ? 1.0 : 0.0;
    
    return x / ((1.0/s - 2.0) * (1.0 - x) + 1.0);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////// sampling routines
//==========================================================================================================//

// s0 [-1..1], s1 [-1..1]
// samples spherical cap for s1 [cosAng05..1]
// samples hemisphere if s1 [0..1]
vec3 Sample_Sphere(float s0, float s1)
{
    float ang = Pi * s0;
    float s1p = sqrt(1.0 - s1*s1);
    
    return vec3(cos(ang) * s1p, 
                           s1 , 
                sin(ang) * s1p);
}

vec3 Sample_Sphere(vec2 s) { return Sample_Sphere(s.x, s.y); }

//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

// interleaved gradient noise | license: unclear
// Jorge Jimenez http://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare
float IGN(vec2 uv) { return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715)))); }

float IGN(vec2 uv, uint frame)
{
    frame = frame % 64u;
    
    uv += 5.588238 * float(frame);
    
    return IGN(uv);
}

// linearizes uv using a Hilbert curve; tile dimension = 2^N
uint EvalHilbertCurve(uvec2 uv, uint N)
{
    uint C = 0xB4361E9Cu;// cost lookup
    uint P = 0xEC7A9107u;// pattern lookup
    
    uint c = 0u;// accumulated cost
    uint p = 0u;// current pattern

    for(uint i = N; --i < N;)
    {
        uvec2 m = (uv >> i) & 1u;// local uv

        uint n = m.x ^ (m.y << 1u);// linearized local uv

        uint o = (p << 3u) ^ (n << 1u);// offset into lookup tables

        c += ((C >> o) & 3u) << (i << 1u);// accu cost (scaled by level)

        p = (P >> o) & 3u;// update pattern
    }
    
    return c;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////// low-discrepancy sobol noise
//==========================================================================================================//
// "Shuffled Scrambled Sobol (2D)" - https://www.shadertoy.com/view/3lcczS | license: unclear
//  code taken from "Practical Hash-based Owen Scrambling" - http://www.jcgt.org/published/0009/04/01/
uint reverse_bits(uint x) 
{
    x = (((x & 0xaaaaaaaau) >> 1) | ((x & 0x55555555u) << 1));
    x = (((x & 0xccccccccu) >> 2) | ((x & 0x33333333u) << 2));
    x = (((x & 0xf0f0f0f0u) >> 4) | ((x & 0x0f0f0f0fu) << 4));
    x = (((x & 0xff00ff00u) >> 8) | ((x & 0x00ff00ffu) << 8));
    
    return ((x >> 16) | (x << 16));
}

// license: unclear
uint laine_karras_permutation(uint x, uint seed) 
{
    x += seed;
    x ^= x*0x6c50b47cu;
    x ^= x*0xb82f1e52u;
    x ^= x*0xc7afe638u;
    x ^= x*0x8d22f6e6u;
    
    return x;
}

// license: unclear
uint nested_uniform_scramble(uint x, uint seed) 
{
    x = reverse_bits(x);
    x = laine_karras_permutation(x, seed);
    x = reverse_bits(x);
    
    return x;
}

// from https://www.shadertoy.com/view/3ldXzM | license: unclear
uvec2 sobol_2d(uint index) 
{
    uvec2 p = uvec2(0u);
    uvec2 d = uvec2(0x80000000u);

    for(; index != 0u; index >>= 1u) 
    {
        if((index & 1u) != 0u) 
        {
            p ^= d;
        }

        d.x >>= 1u;  // 1st dimension Sobol matrix, is same as base 2 Van der Corput
        d.y ^= d.y >> 1u; // 2nd dimension Sobol matrix
    }
    
    return p;
}

// license: unclear
uvec2 shuffled_scrambled_sobol_2d(uint index, uint seed) 
{
    index = nested_uniform_scramble(index, seed);
    
    uvec2 p = sobol_2d(index);
    
    seed = seed * 2891336453u + 1u;
    p.x = nested_uniform_scramble(p.x, seed );
    seed = seed * 2891336453u + 1u;
    p.y = nested_uniform_scramble(p.y, seed);
   
    return p;
}

uint shuffled_scrambled_sobol_angle01(uint x, uint seed) 
{
    x = reverse_bits(x);
    
    x = laine_karras_permutation(x, seed);
    
    return x;
}
//==========================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////// RNG
//==============================================================================================================================================//
uint  asuint2(float x) { return x == 0.0 ? 0u : floatBitsToUint(x); }
uvec2 asuint2(vec2 x) { return uvec2(asuint2(x.x ), asuint2(x.y)); }
uvec3 asuint2(vec3 x) { return uvec3(asuint2(x.xy), asuint2(x.z)); }
uvec4 asuint2(vec4 x) { return uvec4(asuint2(x.xy), asuint2(x.zw)); }

float Float01(uint x) { return float(    x ) * (1.0 / 4294967296.0); }
float Float11(uint x) { return float(int(x)) * (1.0 / 2147483648.0); }

vec2 Float01(uvec2 x) { return vec2(      x ) * (1.0 / 4294967296.0); }
vec2 Float11(uvec2 x) { return vec2(ivec2(x)) * (1.0 / 2147483648.0); }

vec3 Float01(uvec3 x) { return vec3(      x ) * (1.0 / 4294967296.0); }
vec3 Float11(uvec3 x) { return vec3(ivec3(x)) * (1.0 / 2147483648.0); }

vec4 Float01(uvec4 x) { return vec4(      x ) * (1.0 / 4294967296.0); }
vec4 Float11(uvec4 x) { return vec4(ivec4(x)) * (1.0 / 2147483648.0); }

// http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
// https://probablydance.com/2018/06/16/fibonacci-hashing-the-optimization-that-the-world-forgot-or-a-better-alternative-to-integer-modulo/
const float rPhif1 =      0.6180340;
const vec2  rPhif2 = vec2(0.7548777, 0.5698403);
const vec3  rPhif3 = vec3(0.8191725, 0.6710436, 0.5497005);
const vec4  rPhif4 = vec4(0.8566749, 0.7338919, 0.6287067, 0.5385973);

const uint  rPhi1 =       2654435769u;
const uvec2 rPhi2 = uvec2(3242174889u, 2447445413u);
const uvec3 rPhi3 = uvec3(3518319153u, 2882110345u, 2360945575u);
const uvec4 rPhi4 = uvec4(3679390609u, 3152041523u, 2700274805u, 2313257605u);

// low bias version | https://nullprogram.com/blog/2018/07/31/ | license: public domain (http://unlicense.org/)
uint WellonsHash(uint x)
{
    x ^= x >> 16u;
    x *= 0x7feb352dU;
    x ^= x >> 15u;
    x *= 0x846ca68bU;
    x ^= x >> 16u;

    return x;
}

// minimal bias version | https://nullprogram.com/blog/2018/07/31/ | license: public domain (http://unlicense.org/)
uint WellonsHash2(uint x)
{
    x ^= x >> 17u;
    x *= 0xed5ad4bbU;
    x ^= x >> 11u;
    x *= 0xac4c1b51U;
    x ^= x >> 15u;
    x *= 0x31848babU;
    x ^= x >> 14u;

    return x;
}

// http://marc-b-reynolds.github.io/math/2016/03/29/weyl_hash.html | license: public domain (http://unlicense.org/)
uint WeylHash(uvec2 c)
{ 
    return ((c.x * 0x3504f333u) ^ (c.y * 0xf1bbcdcbu)) * 741103597u;
}

// Pierre L'Ecuyer - "TABLES OF LINEAR CONGRUENTIAL GENERATORS OF DIFFERENT SIZES AND GOOD LATTICE STRUCTURE"
// https://www.ams.org/journals/mcom/1999-68-225/S0025-5718-99-00996-5/S0025-5718-99-00996-5.pdf
const uint lcgM = 2891336453u;// ideal for 32 bits with odd c

uint lcg(uint h)
{
    return h * lcgM + 0x5C995C6Du;
}

#define SEED uvec4(0x5C995C6Du, 0x6A3C6A57u, 0xC65536CBu, 0x3563995Fu)

// Melissa E. O’Neill - "PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms for Random Number Generation"
// https://www.cs.hmc.edu/tr/hmc-cs-2014-0905.pdf

// Mark Jarzynski & Marc Olano - "Hash Functions for GPU Rendering"
// http://jcgt.org/published/0009/03/02/ | https://www.shadertoy.com/view/XlGcRh
uvec3 pcg3Mix(uvec3 h)
{
    h.x += h.y * h.z; 
    h.y += h.z * h.x; 
    h.z += h.x * h.y;
    
    return h;
}

uvec3 pcg3Permute(uvec3 h)
{
    h = pcg3Mix(h);

    h ^= h >> 16u;
    
    return pcg3Mix(h);
}

uvec3 pcg3(inout uint state)
{
    state = lcg(state);

    return pcg3Permute(uvec3(2447445413u, state, 3242174889u));
}

uvec3 pcg3(uvec3 h, uint seed)
{
    uvec3 c = (seed << 1u) ^ SEED.xyz;
    
    return pcg3Permute(h * lcgM + c);
}

uvec4 pcg4Mix(uvec4 h)
{
    h.x += h.y * h.w; 
    h.y += h.z * h.x; 
    h.z += h.x * h.y;
    h.w += h.y * h.z;
    
    return h;
}

uvec4 pcg4Permute(uvec4 h)
{
    h = pcg4Mix(h);

    h ^= h >> 16u;
    
    return pcg4Mix(h);
}

uvec4 pcg4(inout uint state)
{
    state = lcg(state);

    return pcg4Permute(uvec4(2882110345u, state, 3518319153u, 2360945575u));
}

uvec4 pcg4(uvec4 h, uint seed)
{
    uvec4 c = (seed << 1u) ^ SEED;

    return pcg4Permute(h * lcgM + c);
}

uint pcg(inout uint state)
{
    state = lcg(state);
    
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    
    return (word >> 22u) ^ word;
}

uint pcg(uint h, uint seed)
{
    uint c = (seed << 1u) ^ SEED.x;

    h = h * lcgM + c;
    
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    
    return (h >> 22u) ^ h;
}

#undef SEED

//---------------------------------------------------------------------------------------------//

uint  Hash(uint  h, uint seed) { return pcg(h, seed); }
uvec2 Hash(uvec2 h, uint seed) { return pcg3(uvec3(h, 0u), seed).xy; }
uvec3 Hash(uvec3 h, uint seed) { return pcg3(h, seed); }
uvec4 Hash(uvec4 h, uint seed) { return pcg4(h, seed); }

vec4 Hash01x4(vec4  v, uint seed) { return Float01(pcg4(asuint2(v), seed)); }
vec4 Hash01x4(vec3  v, uint seed) { return Hash01x4(vec4(v, 0.0          ), seed); }
vec4 Hash01x4(vec2  v, uint seed) { return Hash01x4(vec4(v, 0.0, 0.0     ), seed); }
vec4 Hash01x4(float v, uint seed) { return Hash01x4(vec4(v, 0.0, 0.0, 0.0), seed); }

vec3 Hash01x3(vec4  v, uint seed) { return Float01(pcg4(asuint2(v), seed).xyz); }
vec3 Hash01x3(vec3  v, uint seed) { return Float01(pcg3(asuint2(v), seed)); }
vec3 Hash01x3(vec2  v, uint seed) { return Hash01x3(vec3(v, 0.0     ), seed); }
vec3 Hash01x3(float v, uint seed) { return Hash01x3(vec3(v, 0.0, 0.0), seed); }

vec2 Hash01x2(vec4  v, uint seed) { return Float01(pcg4(asuint2(v), seed).xy); }
vec2 Hash01x2(vec3  v, uint seed) { return Float01(pcg3(asuint2(v), seed).xy); }
vec2 Hash01x2(vec2  v, uint seed) { return Hash01x3(vec3(v, 0.0     ), seed).xy; }
vec2 Hash01x2(float v, uint seed) { return Hash01x3(vec3(v, 0.0, 0.0), seed).xy; }

float Hash01(vec4  v, uint seed) { return Float01(pcg4(asuint2(v), seed).x); }
float Hash01(vec3  v, uint seed) { return Float01(pcg3(asuint2(v), seed).x); }
float Hash01(vec2  v, uint seed) { return Float01(pcg3(asuint2(vec3(v, 0.0)), seed).x); }
float Hash01(float v, uint seed) { return Float01(pcg(asuint2(v), seed)); }


vec4 Hash11x4(vec4  v, uint seed) { return Float11(pcg4(asuint2(v), seed)); }
vec4 Hash11x4(vec3  v, uint seed) { return Hash11x4(vec4(v, 0.0          ), seed); }
vec4 Hash11x4(vec2  v, uint seed) { return Hash11x4(vec4(v, 0.0, 0.0     ), seed); }
vec4 Hash11x4(float v, uint seed) { return Hash11x4(vec4(v, 0.0, 0.0, 0.0), seed); }

vec3 Hash11x3(vec4  v, uint seed) { return Float11(pcg4(asuint2(v), seed).xyz); }
vec3 Hash11x3(vec3  v, uint seed) { return Float11(pcg3(asuint2(v), seed)); }
vec3 Hash11x3(vec2  v, uint seed) { return Hash11x3(vec3(v, 0.0     ), seed); }
vec3 Hash11x3(float v, uint seed) { return Hash11x3(vec3(v, 0.0, 0.0), seed); }

vec2 Hash11x2(vec4  v, uint seed) { return Float11(pcg4(asuint2(v), seed).xy); }
vec2 Hash11x2(vec3  v, uint seed) { return Float11(pcg3(asuint2(v), seed).xy); }
vec2 Hash11x2(vec2  v, uint seed) { return Hash11x3(vec3(v, 0.0     ), seed).xy; }
vec2 Hash11x2(float v, uint seed) { return Hash11x3(vec3(v, 0.0, 0.0), seed).xy; }

float Hash11(vec4  v, uint seed) { return Float11(pcg4(asuint2(v), seed).x); }
float Hash11(vec3  v, uint seed) { return Float11(pcg3(asuint2(v), seed).x); }
float Hash11(vec2  v, uint seed) { return Float11(pcg3(asuint2(vec3(v, 0.0)), seed).x); }
float Hash11(float v, uint seed) { return Float11(pcg(asuint2(v), seed)); }


vec4 Hash01x4(uvec4 v, uint seed) { return Float01(pcg4(v, seed)); }
vec4 Hash01x4(uvec3 v, uint seed) { return Hash01x4(uvec4(v, 0u        ), seed); }
vec4 Hash01x4(uvec2 v, uint seed) { return Hash01x4(uvec4(v, 0u, 0u    ), seed); }
vec4 Hash01x4(uint  v, uint seed) { return Hash01x4(uvec4(v, 0u, 0u, 0u), seed); }

vec3 Hash01x3(uvec4 v, uint seed) { return Float01(pcg4(v, seed).xyz); }
vec3 Hash01x3(uvec3 v, uint seed) { return Float01(pcg3(v, seed)); }
vec3 Hash01x3(uvec2 v, uint seed) { return Hash01x3(uvec3(v, 0u    ), seed); }
vec3 Hash01x3(uint  v, uint seed) { return Hash01x3(uvec3(v, 0u, 0u), seed); }

vec2 Hash01x2(uvec4 v, uint seed) { return Float01(pcg4(v, seed).xy); }
vec2 Hash01x2(uvec3 v, uint seed) { return Float01(pcg3(v, seed).xy); }
vec2 Hash01x2(uvec2 v, uint seed) { return Hash01x3(uvec3(v, 0u    ), seed).xy; }
vec2 Hash01x2(uint  v, uint seed) { return Hash01x3(uvec3(v, 0u, 0u), seed).xy; }

float Hash01(uvec4 v, uint seed) { return Float01(pcg4(v, seed).x); }
float Hash01(uvec3 v, uint seed) { return Float01(pcg3(v, seed).x); }
float Hash01(uvec2 v, uint seed) { return Float01(pcg3(uvec3(v, 0u), seed).x); }
float Hash01(uint  v, uint seed) { return Float01(pcg(v, seed)); }


vec4 Hash11x4(uvec4 v, uint seed) { return Float11(pcg4(v, seed)); }
vec4 Hash11x4(uvec3 v, uint seed) { return Hash11x4(uvec4(v, 0u        ), seed); }
vec4 Hash11x4(uvec2 v, uint seed) { return Hash11x4(uvec4(v, 0u, 0u    ), seed); }
vec4 Hash11x4(uint  v, uint seed) { return Hash11x4(uvec4(v, 0u, 0u, 0u), seed); }

vec3 Hash11x3(uvec4 v, uint seed) { return Float11(pcg4(v, seed).xyz); }
vec3 Hash11x3(uvec3 v, uint seed) { return Float11(pcg3(v, seed)); }
vec3 Hash11x3(uvec2 v, uint seed) { return Hash11x3(uvec3(v, 0u    ), seed); }
vec3 Hash11x3(uint  v, uint seed) { return Hash11x3(uvec3(v, 0u, 0u), seed); }

vec2 Hash11x2(uvec4 v, uint seed) { return Float11(pcg4(v, seed).xy); }
vec2 Hash11x2(uvec3 v, uint seed) { return Float11(pcg3(v, seed).xy); }
vec2 Hash11x2(uvec2 v, uint seed) { return Hash11x3(uvec3(v, 0u    ), seed).xy; }
vec2 Hash11x2(uint  v, uint seed) { return Hash11x3(uvec3(v, 0u, 0u), seed).xy; }

float Hash11(uvec4 v, uint seed) { return Float11(pcg4(v, seed).x); }
float Hash11(uvec3 v, uint seed) { return Float11(pcg3(v, seed).x); }
float Hash11(uvec2 v, uint seed) { return Float11(pcg3(uvec3(v, 0u), seed).x); }
float Hash11(uint  v, uint seed) { return Float11(pcg(v, seed)); }

//==============================================================================================================================================//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/*
float invCubic(float x)
{
    float ac = acos(x * 2.0 - 1.0);
    
    return cos(Pi/3.0 + ac * (1.0/3.0)) + 0.5;
}

float invSinstep(float x)
{
    float ac = ACos(x * 2.0 - 1.0);
    
    return 1.0 - ac * RcpPi;
}

float invSinstep(float x, float u)
{
    float ac = ACos(x * 2.0 - 1.0);
    
    const vec2 n = vec2(   1.0,  Pi/3.0);
    const vec2 m = vec2(-RcpPi, 1.0/3.0);
    
    float invSin =     n.x + ac * m.x;
    float invCub = cos(n.y + ac * m.y) + 0.5;
    
    return mix(invCub, invSin, u);
}

vec2 foobleRef(float angN)
{
    float snAng = sin(angN);
    float csAng = cos(angN);
    
    vec2 angN2 = vec2(2.0, -2.0) * angN;
    
    vec2 n =  6.0*csAng   + (angN2 + Pi) * (-2.0 + vec2(snAng, -snAng));
    vec2 d = (6.0/Pi-2.0) * (angN2 + Pi) * ( 1.0 + vec2(snAng, -snAng));
    
    return n / d;
}

float foobleApprox0(float x)
{
    return 1.0 + x * (1.4135 + (0.718749 + 0.142714 * x) * x);
}

vec2 foobleApprox(float angN)
{
    return vec2(foobleApprox0( angN),
                foobleApprox0(-angN));
}

float cubic(float x){return x*x*(3.0-2.0*x);}
float cdf_toe(float x, float s)
{
    //if(s < 0.1) return cubic(x*0.5)*2.0;

    s *= Pi;
    
    float cs = cos(s) * s;
    float ss = sin(s);
    
    float n = x * cs - ss + sin(s - s * x);
    float d = cs - ss;
    
    return n / d;
}

float icdf_toe_ref(float y, float s)
{
    float x0 = 0.0;
    float x1 = 1.0;
    
    float f0 = 0.0 - y;
    float f1 = 1.0 - y;
    
    float count = 32.0;
    for(float i = 0.0; i < count; ++i)
    {
        float x = (x0 + x1) * 0.5;
        if(false)
        {
            float w = clamp01(f0 / (f0 - f1));
            x = x0 * (1.0 - w) + x1 * w;
        }
        float f = cdf_toe(x, s) - y;
        
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

    return x0;

    float w = clamp01(f0 / (f0 - f1));
    return x0 * (1.0 - w) + x1 * w;
        
    return (x0*abs(f1) + x1*abs(f0)) / (abs(f0) + abs(f1));
}

float icdf_ref(float x, float k)
{
    float u = x > 0.5 ? -0.5 : 0.5;
    
    return (icdf_toe_ref(x* (4.0 * u) - (u * 2.0 - 1.0), k) * u - (u - 0.5));
}

float kFromS(float x)
{
    const float a = 0.419;
    const float b = 0.903;
    const float c = -0.2199307887751623;

    float xx = x * x;

    float u = xx + (x * xx - xx) * (a + xx * ((b - a) + (1.0 - b) * x));
    
    return c + (1.0 - c) * u;
}

float icdf_toe(float x, float k)
{
    //float k = kFromS(s);
    
    float x2 = sqrt(x);
    float x3 = pow(x, 1.0/3.0);
    
  #if 1
    // inverse sinstep toe
    float a = x2 * (0.9003163161571062 + x * (0.07759966342769209 + (0.007231952305716106 + 0.014852068109485703 * x) * x));
    
    // inverse sinstep2 toe
    float b = x3 * (0.8471308576374195 + (0.13907161805849433 + 0.013797524304086095 * x) * x);
          b*= 1.0 + 0.0395238 * (x2 * ((1.0 - x)*(1.0 - x)));    
  #elif 1
    // inverse sinstep toe
    float a = x2 * (0.9003163161571062 + x * (0.07788191259280722 + (0.006667453975485694 + 0.015134317274600954 * x) * x));
    
    // inverse sinstep2 toe
    float b = x3 * (0.8471308576374195 + (0.13907161805849433 + 0.013797524304086095 * x) * x);
          b*= 1.0 + 0.0390765 * (x2 * ((1.0 - x)*(1.0 - x)));    
  #else
    // inverse sinstep toe
    float a = x2 * (0.9003163161571062 + x * (0.07769284616641428 + (0.007045586828271703 + 0.014945250848207962 * x) * x));
    
    // inverse sinstep2 toe
    float b = x3 * (0.8471308576374195 + (0.13907161805849433 + 0.013797524304086095 * x) * x);
          b*= 1.0 + 0.03822 * (x2 * ((1.0 - x)*(1.0 - x)));
  #endif
    
    float num = a * b;
    float den = b + (a - b) * k;
    
    return max(0.0, num / den);// kill nan
    //return x == 0.0 ? 0.0 : num / den;// kill nan
}

float icdf(float x, float k)
{
    float u = x > 0.5 ? -0.5 : 0.5;
    
    return (icdf_toe(x* (4.0 * u) - (u * 2.0 - 1.0), k) * u - (u - 0.5));
}

vec3 Eval_DistantLight(uint occBits, vec3 X, vec3 Y, float angN, float cosN, float sinN, float angJitter)
{
    float x0 = 0.5 + Pi025 * (sinN / (cosN + angN * sinN));

    vec2 s0 = vec2(0.5 + angN * RcpPi,
                   0.5 - angN * RcpPi);// used by Ref + B
    
    vec2 k0 = vec2(SliceRelInverseCDF0_Cos_B_kFromS(s0.x), 
                   SliceRelInverseCDF0_Cos_B_kFromS(s0.y));// used by B

    vec2 u0 = vec2(SliceRelInverseCDF0_Cos_A_uFromAngN( angN),
                   SliceRelInverseCDF0_Cos_A_uFromAngN(-angN));// used by A
                   
    vec2 u1 = mix(u0, u0*u0, 0.085);// used by A+

#if 1
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
#else
    float mS0 = 1.0 /        x0 ;
    float mS1 = 1.0 / (1.0 - x0);
    
    float mA0 = 0.0;
    float mA1 = -x0 * mS1;
        
    float nS0 = Pi05 + angN;
    float nS1 = Pi05 - angN;
    
   #if 1
    // use X = WVec_from_VVec(smplDirVS) | Y = WVec_from_VVec(V)
    // fold [y -= angN] into [y = y * nS + nA]:
    float nA0 =-nS0;
    float nA1 = 0.0;
   #else
    // use X = WVec_from_VVec(normalize(T)) | Y = WVec_from_VVec(normalize(projN))
    float nA0 = -Pi05;
    float nA1 = angN;
   #endif
#endif

    // (partial) bit counting:
    const uint bitsPerSector = 1u;// 1 2 4 8 -> dir count: 32 16 8 4

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
        
       // if(occBits0 == msk) continue;// not sure if this is a good idea
        
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
    
        #if 1
            float y = InvSinstep11(x);
                  //y = SliceRelInverseCDF0_Cos_A11(x, u);
                  //y = SliceRelInverseCDF0_Cos_A11(x, mix(uA, u, x*x));
                  //y = SliceRelInverseCDF0_Cos_B11(x, side ? k0.x : k0.y);
                  y = SliceRelInverseCDF0_Cos_Ref11(x, side ? s0.x : s0.y);
        #else
            float y = InvSinstep(x);
                  //y = SliceRelInverseCDF0_Cos_A(x, u);
                  //y = SliceRelInverseCDF0_Cos_A(x, mix(uA, u, (x - x * x) * 4.0));
                  //y = SliceRelInverseCDF0_Cos_B(x, side ? k0.x : k0.y);
                  //y = SliceRelInverseCDF0_Cos_Ref(x, side ? s0.x : s0.y);
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
*/
