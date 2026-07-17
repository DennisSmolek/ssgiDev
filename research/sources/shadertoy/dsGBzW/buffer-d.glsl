// Shadertoy dsGBzW — Screen Space Horizon GI
// Author: Mathis (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Buffer D
// Source: https://www.shadertoy.com/view/dsGBzW
// Captured live via Chrome (gShaderToy state) on 2026-07-17

//Copy G-Buffer

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0,fragCoord*IRES);
}
