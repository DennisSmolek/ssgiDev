// Shadertoy wcsXDN — Slice-Rel Dir Mapping [GT-VBAO]
// Author: TinyTexel (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Common
// Source: https://www.shadertoy.com/view/wcsXDN
// Captured live via Chrome (gShaderToy state) on 2026-07-17

#define PixelCount iResolution.xy
#define clamp01(x) clamp(x, 0.0, 1.0)
#define rsqrt inversesqrt

/* http://keycode.info/ */
#define KEY_LEFT  37
#define KEY_UP    38
#define KEY_RIGHT 39
#define KEY_DOWN  40

#define KEY_TAB 9
#define KEY_CTRL 17
#define KEY_SHIFT 16
#define KEY_SPACE 32 
#define KEY_A 0x41
#define KEY_D 0x44
#define KEY_S 0x53
#define KEY_W 0x57
#define KEY_Q 81
#define KEY_E 69
#define KEY_R 82
#define KEY_T 84
#define KEY_Z 90
#define KEY_U 85
#define KEY_I 73
#define KEY_O 79
#define KEY_P 80
#define KEY_F 70
#define KEY_G 71
#define KEY_H 72
#define KEY_J 74
#define KEY_K 75
#define KEY_L 76
#define KEY_Y 89
#define KEY_X 88
#define KEY_C 67
#define KEY_V 86
#define KEY_B 66
#define KEY_N 78
#define KEY_M 77

#define KEY_N0 48
#define KEY_N1 49
#define KEY_N2 50
#define KEY_N3 51
#define KEY_N4 52
#define KEY_N5 53
#define KEY_N6 54
#define KEY_N7 55
#define KEY_N8 56
#define KEY_N9 57

const float Pi = 3.14159265359;
const float Pi05  = Pi * 0.5;
const float Pi025 = Pi * 0.25;
const float Pi2  = Pi * 2.0;
const float RcpPi= 1.0 / Pi;

float Pow2(float x) {return x*x;}
float Pow3(float x) {return x*x*x;}
float Pow4(float x) {return Pow2(Pow2(x));}

float GammaEncode(float x) {return pow(x, 1.0 / 2.2);}
vec2 GammaEncode(vec2 x) {return pow(x, vec2(1.0 / 2.2));}
vec3 GammaEncode(vec3 x) {return pow(x, vec3(1.0 / 2.2));}
vec4 GammaEncode(vec4 x) {return pow(x, vec4(1.0 / 2.2));}

float ddxyLen(float v) { return length(vec2(dFdx(v), dFdy(v))); }
float ddxyRcpLen(float v) { return rsqrt( Pow2(dFdx(v)) + Pow2(dFdy(v)) ); }


float rescale(float v) { return v * ddxyRcpLen(v); }

float Graph(float f, float b)
{
    return clamp01(1.0 - (abs(rescale(f))-0.5-b)); 
}


float Line(float u, float b) { return Graph(u, b); }
float Lines(float u, float b) { return Graph(sin(u * Pi), b); }

float Grid(vec2 uv, float b)
{
    float xl = Lines(uv.x, b);    
    float yl = Lines(uv.y, b);

    return max(xl, yl);
}

float Cross(vec2 uv, float b)
{
    float xl = Line(uv.x, b);    
    float yl = Line(uv.y, b);

    return max(xl, yl);
}

float Dot(vec2 uv, vec2 dp, float dr)
{
    float v = length(uv - dp) - dr;
    
    if(v > dr) return 0.0;
    
    v *= ddxyRcpLen(v);
    v = 1.0 - clamp(v * 1.0, 0.0, 1.0);
    
    return v;
}


/*
float invCubic_Ref(float x)
{
    float ac = acos(x * 2.0 - 1.0);
    
    return cos(Pi/3.0 + ac * (1.0/3.0)) + 0.5;
}

float invSinstep_Ref(float x)
{
    float ac = acos(x * 2.0 - 1.0);
    
    return 1.0 - ac * RcpPi;
}

#if 1
vec2 icdfA_uFromAngN_Ref(float angN)
{
    float snAng = sin(angN);
    float csAng = cos(angN);
    
    vec2 angN2 = vec2(2.0, -2.0) * angN;
    
    vec2 n =  6.0*csAng   + (angN2 + Pi) * (-2.0 + vec2(snAng, -snAng));
    vec2 d = (6.0/Pi-2.0) * (angN2 + Pi) * ( 1.0 + vec2(snAng, -snAng));
    
    return n / d;
}
#else
vec2 icdfA_uFromAngN_Ref(float angN)
{
    float snAng = sin(angN);
    float csAng = cos(angN);
    
    float a = 2.0 * angN * snAng;
    float b = Pi * snAng;
    float c = 6.0 * csAng;
    
    float n0 = c + (-2.0*Pi + a);
    float n1 = b - 4.0*angN;
    
    float d = 6.0/Pi - 2.0;
    
    float d0 = Pi + a;
    float d1 = b + 2.0*angN;
    
    return vec2(n0 + n1, n0 - n1) / (d * vec2(d0 + d1, d0 - d1));
}
#endif

vec4 SliceRelCDF_Cos_Map(float angN, float cosN, float sinN)
{
    vec2  a = vec2(0.75, 0.25) * cosN + vec2(sinN * angN, 0.0) + sinN * Pi025;
    float b =             1.0 / (cosN +      sinN * angN);
    
    return vec4(-0.25, 0.25, a) * b;
}

float tf(float x)
{
    //return x*Pi05;
    
    float xx = x*x;
    
    return x * (1.9783394337818323 + xx * (-0.2135497606277662 - 0.19399334635916973 * xx));
}

float SliceRelCDF_Cos(float phi, float angN)
{
    float cosN = cos(angN);
    float sinN = sin(angN);
    
    bool c = phi > angN;
    
    float n0 = c ?  3.0/4.0 : 1.0/4.0;
    float n1 = c ? -1.0/4.0 : 1.0/4.0;
    float n2 = c ?  1.0     : 0.0;
    
    float phi0 = phi;
    phi *= 2.0;
    
    //float t0 = n0 * cosN + n1 * cos(angN - phi) + (n2 * angN + n1 * phi + Pi) * sin(angN);
    
    //float d0 = n1 * (cos(angN - phi) + sinN * phi);
    //float d0 = n1 * (cos(angN)*cos(phi) + sinN*sin(phi) + sinN * phi);
    //float d0 = n1 * (cosN*cos(phi) + sinN*(phi + sin(phi)));
    //float d0 = n1 * (cosN*(cos(phi0)*cos(phi0)-sin(phi0)*sin(phi0)) + sinN*2.0*(phi0 + sin(phi0)*cos(phi0)));
    float d0 = n1 * (cosN*(1.0-2.0*sin(phi0)*sin(phi0)) + sinN*2.0*(phi0 + sin(phi0)*cos(phi0)));
    //d0 = n1 * (cosN*(1.0-2.0*sin(phi0)*sin(phi0)) + sinN*2.0*tf(sin(phi0)));
    
    //return d0;
    //float t0 = n0 * cosN + sinN * (angN * n2 + Pi025);
    float t0 = n0 * cosN + n2 * sinN * angN + sinN * Pi025;
    float t1 = 1.0/(cosN + sinN *  angN);
    //float t1 = 4.0 * (cosN + angN * sin(angN));
    
    return d0 * t1 + t0 * t1;
}


float cdf(float x, float s)
{
    //if(s < 0.05) return x*x*(3.0-2.0*x);
    
    s *= Pi;
    
    float cs = cos(s);
    float ss = sin(s);
    
    float o = 2.0 * s * cs;
    
    float a = o * x  - ss + sin(s * (1.0 - 2.0 * x));
    float b = o      - ss * 2.0;
    
    return a / b;
}

float cdfD1(float x, float s)
{
    //if(s < 0.05) return x * (6.0 - 6.0 * x);
    
    s *= Pi;
    
    float cs = cos(s);
    float ss = sin(s);
    
    float o = 2.0 * s * cs;
    
    float a = o - 2.0*s*cos(s * (1.0 - 2.0 * x));
    float b = o - 2.0 * ss;
    
    return a / b;
}

    
    For GT-VBAO/GI the 'up'-vector corresponds to the view vector.
     -> i.e. if we were to only ever look at surfaces in at a right angle with an ortho camera we could just use regular cosine lobe sampling for 
        slice sampling (horizontal angle) and slice-relative direction mapping (vertical angle).
*/
