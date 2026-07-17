// Mirror: Screen Space Indirect Lighting with Visibility Bitmask
// Source: https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/
// Based on: "Screen Space Indirect Lighting with Visibility Bitmask" by Olivier Therrien, Yannick Levesque, Guillaume Gilet
// Blog: https://cdrinmatane.github.io/posts/ssaovb-code/
// Paper: https://arxiv.org/abs/2301.11376
//
// Note: This is an implementation port by cybereality for the Degine OpenGL/WebGL engine.
// It is NOT a direct mirror of a Shadertoy shader, but rather an adaptation of the academic paper
// and research blog code into a complete working GLSL fragment shader.
//
// Faithfulness: Port / Implementation (adapted for standalone usage)
// License: Implementation is provided on cybereality.com for educational/use purposes

#version 300 es

// Adapted from "Screen Space Indirect Lighting with Visibility Bitmask" by Olivier Therrien, et al.
// https://cdrinmatane.github.io/posts/cgspotlight-slides/

precision highp float;
precision highp sampler2D;

in vec2 fragUV;
out vec4 fragColor;

uniform sampler2D screenPosition;
uniform sampler2D screenNormal;
uniform sampler2D screenLight;

uniform float sampleCount;
uniform float sampleRadius;
uniform float sliceCount;
uniform float hitThickness;

uniform vec2 screenSize;
uniform mat4 projection;

const float pi = 3.14159265359;
const float twoPi = 2.0 * pi;
const float halfPi = 0.5 * pi;

// https://blog.demofox.org/2022/01/01/interleaved-gradient-noise-a-different-kind-of-low-discrepancy-sequence/
float randf(int x, int y) {
    return mod(52.9829189 * mod(0.06711056 * float(x) + 0.00583715 * float(y), 1.0), 1.0);
}

// https://graphics.stanford.edu/%7Eseander/bithacks.html
uint bitCount(uint value) {
    value = value - ((value >> 1u) & 0x55555555u);
    value = (value & 0x33333333u) + ((value >> 2u) & 0x33333333u);
    return ((value + (value >> 4u) & 0x0F0F0F0Fu) * 0x01010101u) >> 24u;
}

// https://cdrinmatane.github.io/posts/ssaovb-code/
const uint sectorCount = 32u;
uint updateSectors(float minHorizon, float maxHorizon, uint outBitfield) {
    uint startBit = uint(minHorizon * float(sectorCount));
    uint horizonAngle = uint(ceil((maxHorizon - minHorizon) * float(sectorCount)));
    uint angleBit = horizonAngle > 0u ? uint(0xFFFFFFFFu >> (sectorCount - horizonAngle)) : 0u;
    uint currentBitfield = angleBit << startBit;
    return outBitfield | currentBitfield;
}

// get indirect lighting and ambient occlusion
vec4 getVisibility() {
    uint indirect = 0u;
    uint occlusion = 0u;

    float visibility = 0.0;
    vec3 lighting = vec3(0.0);
    vec2 frontBackHorizon = vec2(0.0);
    vec2 aspect = screenSize.yx / screenSize.x;
    vec3 position = texture(screenPosition, fragUV).rgb;
    vec3 camera = normalize(-position);
    vec3 normal = normalize(texture(screenNormal, fragUV).rgb);

    float sliceRotation = twoPi / (sliceCount - 1.0);
    float sampleScale = (-sampleRadius * projection[0][0]) / position.z;
    float sampleOffset = 0.01;
    float jitter = randf(int(gl_FragCoord.x), int(gl_FragCoord.y)) - 0.5;

    for (float slice = 0.0; slice < sliceCount + 0.5; slice += 1.0) {
        float phi = sliceRotation * (slice + jitter) + pi;
        vec2 omega = vec2(cos(phi), sin(phi));
        vec3 direction = vec3(omega.x, omega.y, 0.0);
        vec3 orthoDirection = direction - dot(direction, camera) * camera;
        vec3 axis = cross(direction, camera);
        vec3 projNormal = normal - axis * dot(normal, axis);
        float projLength = length(projNormal);

        float signN = sign(dot(orthoDirection, projNormal));
        float cosN = clamp(dot(projNormal, camera) / projLength, 0.0, 1.0);
        float n = signN * acos(cosN);

        for (float currentSample = 0.0; currentSample < sampleCount + 0.5; currentSample += 1.0) {
            float sampleStep = (currentSample + jitter) / sampleCount + sampleOffset;
            vec2 sampleUV = fragUV - sampleStep * sampleScale * omega * aspect;
            vec3 samplePosition = texture(screenPosition, sampleUV).rgb;
            vec3 sampleNormal = normalize(texture(screenNormal, sampleUV).rgb);
            vec3 sampleLight = texture(screenLight, sampleUV).rgb;
            vec3 sampleDistance = samplePosition - position;
            float sampleLength = length(sampleDistance);
            vec3 sampleHorizon = sampleDistance / sampleLength;

            frontBackHorizon.x = dot(sampleHorizon, camera);
            frontBackHorizon.y = dot(normalize(sampleDistance - camera * hitThickness), camera);

            frontBackHorizon = acos(frontBackHorizon);
            frontBackHorizon = clamp((frontBackHorizon + n + halfPi) / pi, 0.0, 1.0);

            indirect = updateSectors(frontBackHorizon.x, frontBackHorizon.y, 0u);
            lighting += (1.0 - float(bitCount(indirect & ~occlusion)) / float(sectorCount)) *
                sampleLight * clamp(dot(normal, sampleHorizon), 0.0, 1.0) *
                clamp(dot(sampleNormal, -sampleHorizon), 0.0, 1.0);
            occlusion |= indirect;
        }
        visibility += 1.0 - float(bitCount(occlusion)) / float(sectorCount);
    }

    visibility /= sliceCount;
    lighting /= sliceCount;

    return vec4(lighting, visibility);
}

void main() {
    fragColor = getVisibility();
}
