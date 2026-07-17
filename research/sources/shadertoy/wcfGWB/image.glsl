// Shadertoy wcfGWB — GT-VBAO distant light sampling
// Author: bjornornorn (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Image
// Source: https://www.shadertoy.com/view/wcfGWB
// Captured live via Chrome (gShaderToy state) on 2026-07-17

/*

This is a variation of TinyTexel's GT-VBAO implementation, that samples a distant light function instead of computing ambient occlusion.
This is done by looping over the occlusion bitfield and reconstructing an approximate direction for each bin, and sampling light in this direction
To instead compute bent normals, those directions could be averaged.

*/


// https://twitter.com/Mirko_Salm/status/1833211198009184650
/*
    Ground truth version of Visibility Bitmask Ambient Occlusion (VBAO | https://arxiv.org/abs/2301.11376).
    This version matches the result of a brute force ray marcher that shares the same limitations and assumptions
    (limited number of screen space depth samples, depth sample distribution along marching direction, thickness assumption).
    GT-VBAO supports both, uniform hemisphere weighting, and cosine weighted hemisphere weighting.
    
    This work was partially fundend by 1000Orks: https://1000orks.com/ | https://x.com/1000orks.
    
    An overview of the original VBAO including source code can be found on Olivier Therrien's blog: https://cdrinmatane.github.io/posts/ssaovb-code/.
    
--- EDIT: A version of GT-VBAO that doesn't require bidirectional ray marching can be found here: https://www.shadertoy.com/view/Xc3yzs
    
    GT-VBAO accounts for the shortcoming of the original VBAO implementation in the following ways:
    
    1. correct slice-local sample distribution: 
        VBAO assumes a uniform distribution of samples in each slice. 
        However, this does not account for the pole at the view vector, which leads to a lower sample density close to angN.
        In addition, for properly cosine weighted AO, the cosine falloff towards the horizons also needs to be considered here.
        
        To account for the non-uniform slice-local sample pdf the min/max-horizon angles are remapped by the corresponding CDF.
        
        Because of the bit mask approach we can't remap the sample locations themselves as it is usually done via the inverse CDF.
        However, we can apply the inverse mapping (i.e. the CDF itself) to the constant interval we intent to sample.
        This also has the advantage that we do not need to invert the CDF (at least as long as we are only interested in AO).
    
    2. treat the slice-local samples as point samples instead of as sectors (+ jitter the sample group as a whole)
        This is done by calculating the quantized arc length from the quantized min/max-horizon angles instead of 
        computing the arc length from the unquantized angles and then quantizing it.
        
        The code here uses an equivalent approach that first computes two bit masks from the min/max-angles, respectively, 
        and then 'ands' those together. The resulting code is a bit more readable and should produce the same number of instructions.
        
    3. account for perspective distorion when not using an orthographic projection
        VBAO treats a perspective camera the same way as an orthographic one. 
        A perspective projection can be accounted for by sampling the slice direction in a local frame around the view vector (view vec space).
        The resulting slice direction can then subsequently be projected to the image plane.
        
        Also, when accounting for the assumed thickness by computing an offseted position from the current depth sample we can not do so using the
        view vector. Instead we need to compute an offset direction for each depth sample associated position individually.
    
    These changes apply to both, the uniformly weighted hemisphere variant, as well as the cosine weighted hemisphere variant of GT-VBAO.
    However, the cosine weighted hemisphere variant also requires us to make changes to the slice direction sampling routine:
    
    4. support for slice direction sampling from a cosine weighted hemisphere via one of 3 options:
        1 - Sample uniformly, but account for the cosine distribution by weighting each slice accordingly.
            This is the most straightforward option, but it produces significant amounts of variance.
        2 - Sample a ray direction from the world space cosine lobe around N. Project this ray direction to the image plane and
            use it as the slice direction. I don't have a prove that this is actually correct, but comparing it to option 1 and to the
            reference ray marcher output it most likely is. While this approach (appears) to perfectly sample proportionally
            to the desired slice pdf, it has the drawback that it requires 2 random numbers to generate a single slice direction.
            This usually reduces the effectiveness of low-discrepancy sequences and sampling patterns that are designed to distribute 
            the sampling error in image space.
        3 - Directly importance sample the one dimensional pdf of slice angles using a single random number. 
            The difficulty with this approach is that the corresponding CDF is not invertible.
            It is, however, possible to construct a pretty good invertible approximation that does not produce any noticeable bias.
            
            The CDF we are trying to approximate is a simple sinusoid s-curve if the view vector is orthogonal to the surface normal.
            The more the view vector alignes with the surface normal the more the s-curve blends towards a simple linear ramp.
            However, at the same time as the linear blend happens the C1-continuous sinusoid s-curve morphes into a C2-continuous sinusoid s-curve.
            The C2-continuous sinusoid s-curve is one of those curves that appear simple at first glance but then turn out to be non-invertible.
            
            The approximation of the inverse CDF I came up with looks like this:
            
            float SampleSlice(float x, float sinNV)
            {
                float s = QBias(sinNV, 0.15);

                      x =    SinStep(x);
                float y = InvSinStep(x, s);
                      y = InvSinStep(y);

                return y;
            } 
            
            SinStep(x) is the C1-continuous sinusoid s-curve and InvSinStep(x) its inverse.
            InvSinStep(x, s) is a generalization that allows to morph the curve into a linear ramp by stretching it
            (simply lerping towards a linear ramp wouldn't give the desired behavior and also wouldn't be invertible).
            QBias(x, b) is a simple quatratic bias used to compute the streching value from the sine of the angle between
            the view vector and the surface normal. The bias of 0.15 is chosen so as to match the ground truth pdf.
            In practice, the first SinStep(x) and the last InvSinStep(y) can be optimized away by not working with angles directly
            (compare the two versions of SampleSliceDir(vvsN, rnd01) in Buffer C).
            
            The sampling option used here can be set via GTVBAO_SLICE_SAMPLING_MODE at the top of Buffer C (default: option 3)
    
    I also tried using a dedicated bit mask for both ray marching directions, separately, but found that, at least for this test scene here, 
    it made very little difference. 32 bits for the whole slice seems like a solid choice.
    
    
    Buffer A: input logic
    Buffer B: g-buffer rendering
    Buffer C: GT-VBAO + reference ray marcher/caster
    Image   : documentation + presentation

    Controls:
    1: split screen comparison of GT-VBAO (left) and reference ray marcher (right)
    2: GT-VBAO
    3: reference ray marcher
    4: grey-scale difference betwwen GT-VBAO and reference (white: too bright | black: too dark)
    5: colored    difference betwwen GT-VBAO and reference (red  : too bright | blue : too dark)
    6: blurred version of 4
    7: blurred version of 5
    -> options 4-7 only make sense to use with converged results

    toggles:
    
    Tab  : toggle temporal accumulation on/off
    Ctrl : toggle ortho cam off/on
    Space: toggle between cosine and uniform hemisphere weighting (changes appearance of UI | default: cosine)

    U    : toggle UI off/on
    
    Camera controls via mouse + shift key.
    
    To compare against the orignal VBAO implementation (generally too bright) toggle uniform hemisphere weighting on and activate 
    USE_ORIGNAL_VBAO_IF_UNIFORM_HEMISHPHERE_WEIGHTING_IS_ACTIVE (at the top of Buffer C).
    
    
    Related/Sources:
    
        -  bidirectional GT-VBGI: https://www.shadertoy.com/view/lfdBWn
        - unidirectional GT-VBGI: https://www.shadertoy.com/view/XcdBWf
        
        -  bidirectional GT-VBAO: https://www.shadertoy.com/view/XXGSDd
        - unidirectional GT-VBAO: https://www.shadertoy.com/view/Xc3yzs
        -  bidirectional GTAO+  : https://www.shadertoy.com/view/lctBzH
        - unidirectional GTAO+  : https://www.shadertoy.com/view/4ctBRH

        - optimized uniformly weighted, bidirectional GT-VBAO: https://www.shadertoy.com/view/4cdfzf

        - Screen Space Indirect Lighting with Visibility Bitmask: the original VBAO
          https://arxiv.org/abs/2301.11376
          
        - An overview of the original VBAO including source code (Olivier Therrien's blog): my initial implementation was based on this
          https://cdrinmatane.github.io/posts/ssaovb-code/
          
        - Practical Real-Time Strategies for Accurate Indirect Occlusion: introduces GTAO, which VBAO is a variant of
          https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf
          
        - Horizon Based Indirect Lighting (HBIL)
          https://github.com/Patapom/GodComplex/tree/master/Tests/TestHBIL
*/


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

#define KeyBoard iChannel2

float ReadKey(int keyCode) {return texelFetch(KeyBoard, ivec2(keyCode, 0), 0).x;}
float ReadKeyToggle(int keyCode) {return texelFetch(KeyBoard, ivec2(keyCode, 2), 0).x;}

#define VarTex iChannel3
#define OutCol outCol
#define OutChannel w

float ReadVar(int cx, int cy) {return texelFetch(VarTex, ivec2(cx, cy), 0).OutChannel;}
vec4 ReadVar4(int cx, int cy) {return vec4(ReadVar(cx, cy), ReadVar(cx, cy + 1), ReadVar(cx, cy + 2), ReadVar(cx, cy + 3));}

/////////////////////////////////////////////////////////////////////////////////// UI
//===============================================================================//

float glyph2(bool style, vec2 tc)
{
    float r0 = 10.0;
    float r1 = 1.;
    float b = max(abs(tc.x), abs(tc.y)) - r0;
    float c = length(tc) - r0*0.9;
    
    b = max(b, -c);
    
    if(!style) if(r1 != 0.0) b = abs(b) - r1;
    
    b = max(b, -(abs(tc.x) - r1));
    b = max(b, -(abs(tc.y) - r1));
    
    return 1.0 - clamp(b + 0.5, 0.0, 1.0);
}

float glyph(bool type, vec2 tc, float r0, float r1, bool separator)
{
    float b = (type ? length(tc) : max(abs(tc.x), abs(tc.y))) - r0;
    
    if(r1 != 0.0) b = abs(b) - r1;
    
    if(separator) b = max(b, -(abs(tc.x) - r1));
    
    return 1.0 - clamp(b + 0.5, 0.0, 1.0);
}

vec2 EvalUI(vec2 uv0, float id, bvec2 modes)
{
    vec2 s = vec2(30.0, 30.0);

    vec2 uv = uv0;

    vec2 uvI = floor(uv / s);
    vec2 uvF = uv - uvI * s;

    if(uvI.y > 0.0 || uvI.x < 0.0 || uvI.x > 3.0) { return vec2(0.0); }

    vec2 tc = uvF-s*0.5;

    float k = 0.35;
    if(uvI.x == id) k = 0.9;

    bool isSolid = false;

    if(uvI.x == 0.0) 
    isSolid = tc.x   < 0.0 ? modes.x : modes.y;
    else
    isSolid = uvI.x == 1.0 ? modes.x : modes.y;
    
    bool type = uvI.x == 1.0;
    if(uvI.x == 0.0) type = tc.x < 0.0;

    float v = glyph(type, tc, 8.0, isSolid ? 0.0 : 2.0, uvI.x == 0.0);
    if(uvI.x == 3.0) v = glyph2(modes.x || modes.y, tc);

    //if(uvI.y > 0.0 || uvI.x < 0.0 || uvI.x > 3.0) { v = 0.0; k = 0.0; }

    return vec2(v, k);
}

//===============================================================================//
///////////////////////////////////////////////////////////////////////////////////

void mainImage(out vec4 outCol, in vec2 uv0)
{
    Resolution = iResolution.xy;

    float num = ReadVar(4, VAR_ROW);

    ivec2 uv = ivec2(uv0.xy - 0.5);
	vec2 tex = uv0.xy / iResolution.xy;
    
    vec3 col = vec3(0.0);
        
    vec2 ao = textureLod(iChannel0, tex, 0.0).rg;
    //num=1.0;
    if(num == 0.0)// split screen: gtvbao | ray-marched reference
    {
        col = vec3(uv0.x > iResolution.x * 0.5 ? ao.x : ao.y);
    }
    else if(num == 1.0)// gtvbao
    {
        col = vec3(ao.y);
    }
    else if(num == 2.0)// ray-marched reference
    {
        col = vec3(ao.x);
    }
    else if(num == 3.0 || num == 4.0)// visualize error
    {
        float diff = (ao.y - ao.x) * 8.0;
        
        if(num == 3.0)
        {
            col = vec3(0.5 + diff*2.0);
        }
        else// num == 4.0: gtvbao brighter than ref -> red | gtvbao darker than ref -> blue
        {
            col = abs(diff) * 3.0 * (diff > 0.0 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.18, 1.0));
        }
    }
    else if(num == 5.0 || num == 6.0)// visualize error blurred
    {
        float count = 10.0;
        float wa = 0.0;
        
        for(float j = -count; j <= count; ++j)
        for(float i = -count; i <= count; ++i)
        {
            vec2 o = vec2(i, j);
            vec2 w2 = pow(1.0 - pow(abs(o)/(count+0.5), vec2(2.0)), vec2(1.0));
            
            float w = 1.0;
            w = w2.x * w2.y;
            
            vec2 ao = textureLod(iChannel0, (uv0 + o) / iResolution.xy, 0.0).rg;
            
            float diff = (ao.y - ao.x) * 8.0;

            vec3 col0;
            
            if(num == 5.0)
            {
                col0 = vec3(abs(diff));
                col0 = vec3(0.5 + diff*2.0);
            }
            else
            {
                col0 = abs(diff) * 3.0 * (diff > 0.0 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.18, 1.0));
            }
        
            col += col0 * w;
            wa += w;
        }
        
        col /= wa;
    }
    
    #if 0
    if(num < 3.0 && ReadKeyToggle(KEY_S) != 0.0)
    {
        // isolines
        col = 1.0-(cos(col * 32.0) * 0.5 + 0.5);
    }
    #endif
    
    // highlight pixels green if they clip beneath 0 or above 1: 
    if(ReadKeyToggle(KEY_N) != 0.0)
    if(col.r < 0.0 || col.r > 1.0 || col.g < 0.0 || col.g > 1.0 || col.b < 0.0 || col.b > 1.0) col.rgb = vec3(0.0, 1.0, 0.0);
    
    outCol = vec4(pow(clamp01(col), vec3(1.0/2.2)), 0.0);
    
    
    if(SHOW_UI_COND)
    {
        bvec2 modes = bvec2(USE_UNIFORM_HEMISHPHERE_WEIGHTING);
        
        vec2 ui = EvalUI(uv0, min(num, 3.0), modes.xx);
        
        outCol.rgb = mix(outCol.rgb, vec3(ui.y) * mix(vec3(0., 0.6, 1.0), vec3(1.0), 0.9), ui.x);
    }    
}
