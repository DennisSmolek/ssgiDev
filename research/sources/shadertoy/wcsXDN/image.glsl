// Shadertoy wcsXDN — Slice-Rel Dir Mapping [GT-VBAO]
// Author: TinyTexel (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Image
// Source: https://www.shadertoy.com/view/wcsXDN
// Captured live via Chrome (gShaderToy state) on 2026-07-17

// https://x.com/Mirko_Salm/status/1949829873335259618
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

/*
    Approximations for the slice-relative direction mapping used by GT-VBAO/GI to implement distant light sampling and light probe sampling.
    
    GT-VBAO [Distant Light Sampling]: https://www.shadertoy.com/view/wc2SzR
    
    Cosine-weighted GT-VBAO/GI uses a generalized cosine lobe sampling where the 'up'-vector does not need to coincide with the surface normal:
        - GT-VBAO/GI's slice sampling corresponds to sampling an azimuthal/horizontal angle phi.
        - The inverse cdf presented here can be use to additionally sample the vertical angle theta.
          -> This allows us to compute the 32 sampling directions that GT-VBAO/GI implicitly ray-marches in its main loop.
          -> And than use these directions to sample a sky box or gi volume for unoccluded samples.

    In a practical setup we would usually only use 4 or 8 of those directions for distant light/light probe sampling, though (as suggested by the original VBAO/GI paper).
    And if only 4 or 8 directions are used, the cheapest of the approximations for InverseCDF presented here suffices (this one was first proposed by Björn Ottosson).
    But by using all 32 directions in combination with the reference InverseCDF we can show that the results can match that of a brute force reference ray-marcher.

    black: InverseCDF(x) (approximation)
    grey :        CDF(x)
    red  : InverseCDF(CDF(x))     (ideally should just end up being x) (the light red ramp in the background serves as a visual reference)
    blue : InverseCDF(CDF(x)) - x (ideally should just end up being 0)
    
    The dots of the grey and black graphs indicate the inflection points where the two (inverse) s-curve pieces that make up the whole curve meet.
    
    Pressing the space key toggles the display mode so that only the left of the two (inverse) s-curves is shown.
    
    The (inverse) s-curve is denoted as (Inverse)CDF0 in the code.
    The approximation quality of InverseCDF0 wholy determines the approximation quality of InverseCDF since 
    the process of stitching the two InverseCDF0s together does not introduce any additional approximation error.
    
    CDF0(x, s) is a generalization of 3 commonly used s-curves:
    
    s -> 0: cubic smoothstep (numerically unstable here)
    s == 1: sine  smoothstep (this is the case when the view vector lies exactly on the center of the slice)
    s == 2: sine  smootherstep (not analytically invertible)
    
    where s = (angN + Pi/2) / Pi; // i.e. map from angN:[-Pi/2,Pi/2] -> s:[0, 1]
    
    InverseCDF0 approximations:
    
    - InvSinstep: the cheapest option; is accurate if the view vector lies exactly on the center of the slice (i.e. angN == 0)
        -> the most practical option; the other variants don't improve the quality of the final result much if only 4 or 8 directions are used
        -> first proposed by Björn Ottosson: https://www.shadertoy.com/view/wcfGWB
    
    - InverseCDF0_A: accurate for angN == -Pi/2 and for angN == 0; inter/extrapolates from InvCubicstep to InvSinstep using angN
        -> blending approach tries to match the derivative at the center of the s-curve 
        -> quite a bit better than just using InvSintep while not being that much more expensive
        
    - InverseCDF0_B: accurate for angN == 0 and for angN == Pi/2; inter/extrapolates from InvSinstep to InvSinstep2 using angN (via rcp mix)
        -> blending approach tries to match the derivative at the center of the s-curve
        -> somewhat decent approximation, but rather expensive
        
    - InverseCDF0_Ref: reference; implemented via brute-force numerical inversion of CDF0 (using a binary search)
    
    
    In the code below the function name postfix '11' denotes that the function maps from [-1,1] to [-1,1] instead of from [0,1] to [0,1].
    I tried to build InverseCDF from both variants to see which one is faster. Using the 11-variants appears to save a few cycles overall.
    
    
    Related/Sources:
    
        - GT-VBAO [Distant Light Sampling]: https://www.shadertoy.com/view/wc2SzR
        
        - Björn Ottosson's work:
            - GT-VBAO distant light sampling  : https://www.shadertoy.com/view/wcfGWB
            - GT-VBAO thickness heuristic     : https://www.shadertoy.com/view/3clGWB
            - GT-VBAO Light&Occluder Heuristic: https://www.shadertoy.com/view/wcBGRz
    
        -  bidirectional GT-VBGI: https://www.shadertoy.com/view/lfdBWn
        - unidirectional GT-VBGI: https://www.shadertoy.com/view/XcdBWf
        
        - optimized uniformly weighted, bidirectional GT-VBGI: https://www.shadertoy.com/view/XfcBDl
    
        -  bidirectional GT-VBAO: https://www.shadertoy.com/view/XXGSDd
        - unidirectional GT-VBAO: https://www.shadertoy.com/view/Xc3yzs
        -  bidirectional GTAO+  : https://www.shadertoy.com/view/lctBzH
        - unidirectional GTAO+  : https://www.shadertoy.com/view/4ctBRH

        - optimized uniformly weighted, bidirectional GT-VBAO: https://www.shadertoy.com/view/4cdfzf

        - Screen Space Indirect Lighting with Visibility Bitmask: SSILVB, the original 'VBGI' (and VBAO)
          https://arxiv.org/abs/2301.11376 (slides: https://cdrinmatane.github.io/posts/cgspotlight-slides/)
          
        - An overview of the original VBAO including source code (Olivier Therrien's blog): my initial implementation was based on this
          https://cdrinmatane.github.io/posts/ssaovb-code/
          
        - Practical Real-Time Strategies for Accurate Indirect Occlusion: introduces GTAO, which VBAO is a variant of
          https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
          
        - Horizon Based Indirect Lighting (HBIL)
          https://github.com/Patapom/GodComplex/tree/master/Tests/TestHBIL    
*/

/////////////////////////////////////////////////////////////////////////////////
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

float SliceRelInverseCDF0_Cos_Ref(float x, float s)
{
    x = x * 2.0 - 1.0;
    
    float u = x > 0.0 ? -1.0 : 1.0;
    
    float y = (SliceRelInverseCDF0_Cos_Toe(x * u + 1.0, s) * u - u);
    
    return y * 0.5 + 0.5;
}

float SliceRelInverseCDF0_Cos_Ref11(float x, float s)
{
    float u = x > 0.0 ? -1.0 : 1.0;
    
    return SliceRelInverseCDF0_Cos_Toe(x * u + 1.0, s) * u - u;
}
/////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////
// InvSinstep: poor quality approximation of the inverse cdf
float InvSinstep(float x)
{
    x = x * 2.0 - 1.0;

    float k = 1.0 - abs(x);
    
  #if 1
    float y = sqrt(k) * (0.444175 + 0.055825 * k);// least squares
  #else
    float y = sqrt(k) * (0.4501581580785531 + k * (0.03884642308320714 + (0.0035227934141358517 + 0.007472625424103981 * k) * k));
  #endif
    
    return x < 0.0 ? y : 1.0 - y;
}

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

float SliceRelInverseCDF0_Cos_A(float x, float u)
{
  #if 1
    float invSin = InvSinstep(x);
    float invCub = invSin * (0.9069 + (0.2793 - 0.1862 * invSin) * invSin);
        //invCub = cos(invSin * (-Pi/3.0) + (Pi2/3.0)) + 0.5;
  #else
    float ac = acos(x * 2.0 - 1.0);
          //ac = Pi - Pi * InvSinstep(x);
    
    const vec2 n = vec2(   1.0,  Pi/3.0);
    const vec2 m = vec2(-RcpPi, 1.0/3.0);
    
    float invSin =     n.x + ac * m.x;
    float invCub = cos(n.y + ac * m.y) + 0.5;
  #endif
  
    return mix(invCub, invSin, u);
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

float SliceRelInverseCDF0_Cos_B(float x, float s)
{
    x = x * 2.0 - 1.0;
    
    float u = x > 0.0 ? -1.0 : 1.0;
    
    float y = (SliceRelInverseCDF0_Cos_Toe_B(x * u + 1.0, s) * u - u);
    
    return y * 0.5 + 0.5;
}

float SliceRelInverseCDF0_Cos_B11(float x, float s)
{
    float u = x > 0.0 ? -1.0 : 1.0;
    
    return SliceRelInverseCDF0_Cos_Toe_B(x * u + 1.0, s) * u - u;
}
/////////////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////////// <-- MAIN RESULT -------------------------------------------------------------
#if 1
float SliceRelInverseCDF_Cos(float x, float angN)
{
    float snAng = sin(angN);
    float csAng = cos(angN);

    float x0 = 0.5 + Pi025 * (snAng / (csAng + angN * snAng));

    vec2 s0 = vec2(0.5 + angN * RcpPi,
                   0.5 - angN * RcpPi);// used by Ref + B
    
    vec2 k0 = vec2(SliceRelInverseCDF0_Cos_B_kFromS(s0.x), 
                   SliceRelInverseCDF0_Cos_B_kFromS(s0.y));// used by B

    vec2 u0 = vec2(SliceRelInverseCDF0_Cos_A_uFromAngN( angN),
                   SliceRelInverseCDF0_Cos_A_uFromAngN(-angN));// used by A
    
    vec2 u1 = mix(u0, u0*u0, 0.085);// used by A+
    
    float mS0 = 1.0 / (      0.5 * x0);
    float mS1 = 1.0 / (0.5 - 0.5 * x0);
    
    float mA0 = -1.0;
    float mA1 = -1.0 - x0 * mS1;
        
    float nS0 = Pi025 + angN * 0.5;
    float nS1 = Pi025 - angN * 0.5;
    
    #if 0
    // TODO docu
    float nA0 =-nS0;
    float nA1 = nS1;
    #else
    float nA0 =-nS1;
    float nA1 = nS0;
    #endif
    
    bool side = x < x0;
    
    float mA = side ? mA0 : mA1;
    float mS = side ? mS0 : mS1;
    
    float nA = side ? nA0 : nA1;
    float nS = side ? nS0 : nS1;
    
    float s  = side ? s0.x : s0.y;
    float k  = side ? k0.x : k0.y;
    float u  = side ? u0.x : u0.y;
    float uu = side ? u1.x : u1.y;
        
          x = x * mS + mA;
          
    float y = InvSinstep11(x);
          //y = SliceRelInverseCDF0_Cos_A11(x, u);
          y = SliceRelInverseCDF0_Cos_A11(x, mix(u, uu, x*x));
          //y = SliceRelInverseCDF0_Cos_B11(x, k);
          //y = SliceRelInverseCDF0_Cos_Ref11(x, s);
          
          y = y * nS + nA;
          
    return y;
}
#else
float SliceRelInverseCDF_Cos(float x, float angN)
{
    float snAng = sin(angN);
    float csAng = cos(angN);

    float x0 = 0.5 + Pi025 * (snAng / (csAng + angN * snAng));

    vec2 s0 = vec2(0.5 + angN * RcpPi,
                   0.5 - angN * RcpPi);// used by Ref + B
    
    vec2 k0 = vec2(SliceRelInverseCDF0_Cos_B_kFromS(s0.x), 
                   SliceRelInverseCDF0_Cos_B_kFromS(s0.y));// used by B

    vec2 u0 = vec2(SliceRelInverseCDF0_Cos_A_uFromAngN( angN),
                   SliceRelInverseCDF0_Cos_A_uFromAngN(-angN));// used by A
    
    vec2 u1 = mix(u0, u0*u0, 0.085);// used by A+
    
    float mS0 = 1.0 /        x0 ;
    float mS1 = 1.0 / (1.0 - x0);
    
    float mA0 = 0.0;
    float mA1 = -x0 * mS1;
        
    float nS0 = Pi05 + angN;
    float nS1 = Pi05 - angN;
    
    float nA0 = -Pi05;
    float nA1 = angN;

    bool side = x < x0;
    
    float mA = side ? mA0 : mA1;
    float mS = side ? mS0 : mS1;
    
    float nA = side ? nA0 : nA1;
    float nS = side ? nS0 : nS1;
    
    float s  = side ? s0.x : s0.y;
    float k  = side ? k0.x : k0.y;
    float u  = side ? u0.x : u0.y;
    float uu = side ? u1.x : u1.y;
    
          x = x * mS + mA;
    
    float y = InvSinstep(x);
          //y = SliceRelInverseCDF0_Cos_A(x, u);
          y = SliceRelInverseCDF0_Cos_A(x, mix(uu, u, (x - x * x) * 4.0));
          //y = SliceRelInverseCDF0_Cos_B(x, k);
          //y = SliceRelInverseCDF0_Cos_Ref(x, s);
                            
          y = y * nS + nA;
          
    return y;
}
#endif
/////////////////////////////////////////////////////////////////////////////////

#if 1
float SliceRelCDF_Cos(float phi, float angN)
{
    float cosN = cos(angN);
    
    bool c = phi > angN;
    
    float n0 = c ?  3.0 : 1.0;
    float n1 = c ? -1.0 : 1.0;
    float n2 = c ?  4.0 : 0.0;
    
    float t0 = n0 * cosN + n1 * cos(angN - 2.0 * phi) + (n2 * angN + (n1 * 2.0) * phi + Pi) * sin(angN);
    float t1 = 4.0 * (cosN + angN * sin(angN));

    return t0 / t1;
}
#else
vec4 SliceRelCDF_Cos_Map(float angN, float cosN, float sinN)
{
    float a = sinN * angN + cosN;
    float b = cosN * 0.25;
    vec2  c = sinN * Pi025 + vec2(a - b, b);
    float d = 1.0 / a;
    float e = d * 0.25;
    
    return vec4(-e, e, c * d);
}

float SliceRelCDF_Cos(float phi2, float angN, float sinN, vec2 mapN)
{
    float y = sinN * phi2 + cos(angN - phi2);

    return y * mapN.x + mapN.y;
}

float SliceRelCDF_Cos(float phi, float angN)
{
    float cosN = cos(angN);
    float sinN = sin(angN);
    
    vec4 mapN0 = SliceRelCDF_Cos_Map(angN, cosN, sinN);
    
    return SliceRelCDF_Cos(phi * 2.0, angN, sinN, phi > angN ? mapN0.xz : mapN0.yw);
}
#endif

float SliceRelCDF0_Cos(float x, float s)
{
    s *= Pi;
    
    float cs = cos(s);
    float ss = sin(s);
    
    float o = 2.0 * s * cs;
    
    float a = o * x  - ss + sin(s * (1.0 - 2.0 * x));
    float b = o      - ss * 2.0;
    
    return a / b;
}

float SliceRelCDF0_Cos11(float x, float s)
{
    s *= Pi;
    
    float o = s *     cos(s    );
    float a = o * x - sin(s * x);
    float b = o     - sin(s    );
    
    return a / b;
}

float SliceRelInverseCDF0_Cos11(float x, float s)
{
    float angN = s * Pi - Pi05;
    
    float k = SliceRelInverseCDF0_Cos_B_kFromS(s);
    float u = SliceRelInverseCDF0_Cos_A_uFromAngN(angN);
    
    float uu = mix(u, u*u, 0.085);
    
    //return InvSinstep11(x);
    //return SliceRelInverseCDF0_Cos_A11(x, u);
    return SliceRelInverseCDF0_Cos_A11(x, mix(u, uu, x*x));
    //return SliceRelInverseCDF0_Cos_B11(x, k);
    //return SliceRelInverseCDF0_Cos_Ref11(x, k);
}



float ReadKey      (int keyCode) {return texelFetch(iChannel1, ivec2(keyCode, 0), 0).x;}
float ReadKeyToggle(int keyCode) {return texelFetch(iChannel1, ivec2(keyCode, 2), 0).x;}

void mainImage( out vec4 outCol, in vec2 uv0 )
{
	vec2 uv = uv0 - 0.5;
    
    vec2 tex = uv0;
    tex -= iResolution.xy * 0.5;
    tex /= iResolution.xx * 0.125;

    tex *= 0.75;

    vec3 col = vec3(0.0);
    
    // grid
	col = mix(vec3(1.0), vec3(0.9), Grid(tex.xy * 4.0, 0.0));        
	col = mix(col, vec3(0.5), Grid(tex.xy * 1.0, 0.0));        
	col = mix(col, vec3(0.125), Cross(tex.xy * 1.0, 0.)); 	

    // light red: linear ramp (reference for inverse_mapping(forward_mapping))
    col = mix(col, vec3(1.0, 0.0, 0.0), 0.50 * Graph(tex.x - tex.y, 0.5));


    // angle between view vector and the slice-projected normal vector
    float angN = sin(iTime * 0.75) * Pi05;

    if(ReadKeyToggle(KEY_SPACE) == 0.0)
    {
        float xMask = clamp((1.0 - abs(tex.x) / Pi05) * 256.0, 0.0, 1.0);

        // inverse_mapping(forward_mapping)
        float err = SliceRelInverseCDF_Cos(SliceRelCDF_Cos(tex.x, angN), angN);

        // red: inverse_mapping(forward_mapping)
        col = mix(col, vec3(1.0, 0.0, 0.0), 0.90*Graph(         err       - tex.y, 0.5) * xMask);
        // light blue: approx error (x - inverse_mapping(forward_mapping))
        col = mix(col, vec3(0.0, 0.5, 1.0), 0.25*Graph((tex.x - err)*10.0 - tex.y, 0.5) * xMask);

        // dots used to mark the inflection points of the cdf+icdf plots
        float dotMaskA, dotMaskB;
        {
            float snAng = sin(angN);
            float csAng = cos(angN);

            float y0 = 0.5 + Pi025 * (snAng / (csAng + angN * snAng));

            dotMaskA = Dot(tex, vec2(angN, y0), 0.02);
            dotMaskB = Dot(tex, vec2(y0, angN), 0.02);
        }

        // gray: slice-relative cdf (for a sliced cosine lobe)
        col = mix(col, vec3(0.0, 0.0, 0.0), 0.50*max(Graph(SliceRelCDF_Cos       (tex.x, angN) - tex.y, 0.5) * xMask, dotMaskA));
        // black: slice-relative inverse cdf (for a sliced cosine lobe)
        col = mix(col, vec3(0.0, 0.0, 0.0), 0.95*max(Graph(SliceRelInverseCDF_Cos(tex.x, angN) - tex.y, 0.5)        , dotMaskB));
    }
    else
    {
        float xMask = clamp((1.0 - abs(tex.x) / 1.0) * 256.0, 0.0, 1.0);

        float s = 0.5 + angN * RcpPi;// left  s-curve of the piecewise function
                //0.5 - angN * RcpPi;// right s-curve of the piecewise function
        s = max(0.02, s);// avoid numerical issues close to 0 (where the forward mapping converges towards cubic smoothstep)

        // inverse_mapping(forward_mapping)
        float err = SliceRelInverseCDF0_Cos11(SliceRelCDF0_Cos11(tex.x, s), s);

        // red: inverse_mapping(forward_mapping)
        col = mix(col, vec3(1.0, 0.0, 0.0), 0.90*Graph(         err       - tex.y, 0.5) * xMask);
        // light blue: approx error (x - inverse_mapping(forward_mapping))
        col = mix(col, vec3(0.0, 0.5, 1.0), 0.25*Graph((tex.x - err)*10.0 - tex.y, 0.5) * xMask);

        // gray: slice-relative cdf (for a sliced cosine lobe)
        col = mix(col, vec3(0.0, 0.0, 0.0), 0.50*(Graph(SliceRelCDF0_Cos11       (tex.x, s) - tex.y, 0.5) * xMask));
        // black: slice-relative inverse cdf (for a sliced cosine lobe
        col = mix(col, vec3(0.0, 0.0, 0.0), 0.95*(Graph(SliceRelInverseCDF0_Cos11(tex.x, s) - tex.y, 0.5) * xMask));
    }
    
   #if 1
    // vignetting
    {
        vec2 s = (uv0/iResolution.xy*2.0-1.0);
        s.x = 1.0-Pow2(s.x);    s.y = 1.0-Pow2(s.y);
        col *= mix(1.0, 0.4, Pow2(1.0-sqrt(s.x*s.y)));
    }
   #endif
    
    outCol = vec4(GammaEncode(clamp01(col)), 1.0);    

}
