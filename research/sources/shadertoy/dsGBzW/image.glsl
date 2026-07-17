// Shadertoy dsGBzW — Screen Space Horizon GI
// Author: Mathis (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Image
// Source: https://www.shadertoy.com/view/dsGBzW
// Captured live via Chrome (gShaderToy state) on 2026-07-17

/*
Screen space GI
    Horizon integrals allows every texture fetch to potentially contribute to lighting
        Compare to ray marching, where one sample requires many texture fetches along the ray
        Only half of the horizon is integrated at the time
            A bitmask using 32 bits are uniformly distributed along the horizon to approximate occlusion
            The paper explains this better
        More info in the paper:
            https://arxiv.org/pdf/2301.11376.pdf
    Horizons
        Are not actually traced "correctly", they are straight in screen space but not necessarily in world space
            True horizons can have varying shapes
    Denoising
        A temporal accumulator and a bilateral 3x3 denoiser are used
        Dynamic scenes require better denoising
            I think a reservoir approach based on horizons would be good -> sample validation is nice

*/

vec3 acesFilm(vec3 x) {
    return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 Color = texture(iChannel2,fragCoord*IRES).xyz;
    fragColor = vec4(pow(acesFilm(max(vec3(0.),Color)),vec3(0.45)),1.);
}
