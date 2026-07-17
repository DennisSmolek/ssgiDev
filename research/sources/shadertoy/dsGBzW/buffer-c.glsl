// Shadertoy dsGBzW — Screen Space Horizon GI
// Author: Mathis (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Buffer C
// Source: https://www.shadertoy.com/view/dsGBzW
// Captured live via Chrome (gShaderToy state) on 2026-07-17

//Accumulation

vec4 SampleMB(vec2 uv, vec3 PPos, vec3 Normal, vec3 LPos, mat3 LEyeMat, out float Weight) {
    //A weighted sample for a bilinear mix
    vec2 ClampedUV = clamp(uv,vec2(1.5),RES-0.5);
    vec4 C = texture(iChannel3,ClampedUV*IRES);
    vec3 SDir = normalize(vec3((uv*IRES*2.-1.)*(ASPECT*CFOV),1.)*LEyeMat);
    Weight = max(0.0001,float(abs(dot(Normal,LPos+SDir*C.w-PPos))<0.01))*
              max(0.001,float(dot(Normal,normalize(FloatToVec3(C.z)*2.-1.))>0.9));
    return texture(iChannel2,ClampedUV*IRES)*Weight;
}

vec4 ManualBilinear(vec2 uv, vec3 PPos, vec3 Normal, vec3 LPos, mat3 LEyeMat, out float Weight) {
    //Returns weighted RGB sum + weight sum
    vec2 Fuv = floor(uv-0.4999)+0.5;
    float W0,W1,W2,W3;
    vec4 S0 = SampleMB(Fuv,PPos,Normal,LPos,LEyeMat,W0);
    vec4 S1 = SampleMB(Fuv+vec2(1.,0.),PPos,Normal,LPos,LEyeMat,W1);
    vec4 S2 = SampleMB(Fuv+vec2(0.,1.),PPos,Normal,LPos,LEyeMat,W2);
    vec4 S3 = SampleMB(Fuv+vec2(1.),PPos,Normal,LPos,LEyeMat,W3);
    vec2 fuv = fract(uv-0.4999);
    Weight = mix(mix(W0,W1,fuv.x),mix(W2,W3,fuv.x),fuv.y);
    return mix(mix(S0,S1,fuv.x),mix(S2,S3,fuv.x),fuv.y)/Weight;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec4 Output = vec4(0.);
    if (iFrame>1 && DFBox(fragCoord-1.,RES)<0.) {
        float CurrentFrame = float(iFrame);
        vec2 SSOffset = vec2(0.);
        vec3 Pos = texture(iChannel0,vec2(3.5,0.5)*IRES).xyz;
        vec3 Eye = texture(iChannel0,vec2(2.5,0.5)*IRES).xyz;
        vec3 Tan; vec3 Bit = TBN(Eye,Tan);
        mat3 EyeMat = TBN(Eye);
        vec3 Dir = normalize(vec3(((fragCoord+SSOffset)*IRES*2.-1.)*(ASPECT*CFOV),1.)*EyeMat);
        vec4 Attr = texture(iChannel0,fragCoord*IRES);
        if (Attr.y>-0.5) {
            //Geometry
            vec3 PPos = Pos+Dir*Attr.w;
            vec3 Normal = FloatToVec3(Attr.z)*2.-1.;
            
            
            
            //Reprojection
            vec4 LastPixel = vec4(0.);
            vec3 LastPos = texture(iChannel3,vec2(3.5,0.5)*IRES).xyz;
            vec3 LastEye = texture(iChannel3,vec2(2.5,0.5)*IRES).xyz;
            vec3 LastTan; vec3 LastBit = TBN(LastEye,LastTan);
            vec3 RPPos = PPos-LastPos;
            RPPos = vec3(dot(RPPos,LastTan),dot(RPPos,LastBit),dot(RPPos,LastEye));
            vec2 LastUV = (RPPos.xy/(RPPos.z*(ASPECT*CFOV)))*0.5+0.5;
            if (DFBox(LastUV*RES-1.,RES-1.)<0.) {
                //Valid reprojection
                float LastWeight;
                LastPixel = ManualBilinear(LastUV*RES,PPos,Normal,LastPos,TBN(LastEye),LastWeight);
                if (LastWeight<0.01) LastPixel = vec4(0.);
            }
            
            
            
            //Adaptive spatial denoising
            vec4 NewPixel = texture(iChannel1,fragCoord*IRES);
            float NewRadius = max(1.,ceil(1.99-LastPixel.w*0.25));
            float RadiusCoeff = max(1.,2.25-LastPixel.w*0.25);
            if (NewRadius>0.5) {
                float NewWeight = 1.;
                for (float x=-NewRadius; x<NewRadius+0.5; x++) {
                    for (float y=-NewRadius; y<NewRadius+0.5; y++) {
                        vec2 SUV = fragCoord+vec2(x,y)*RadiusCoeff;
                        if (DFBox(SUV-1.,RES-1.)>0.) continue;
                        vec4 SAttr = texture(iChannel0,SUV*IRES);
                        if (x*x+y*y<0.01 || SAttr.y<-0.5) continue;
                        vec3 SDir = normalize(vec3((SUV*IRES*2.-1.)*(ASPECT*CFOV),1.)*EyeMat);
                        float SWeight = max(0.0001,float(dot(Normal,Pos+SDir*SAttr.w-PPos)<0.01))*
                                        max(0.01,float(dot(Normal,normalize(FloatToVec3(SAttr.z)*2.-1.))>0.9));
                        NewPixel += texture(iChannel1,SUV*IRES)*SWeight;
                        NewWeight += SWeight;
                    }
                }
                NewPixel /= NewWeight;
            }
            
            
            
            //Accumulation
            Output = vec4((LastPixel.xyz*LastPixel.w+NewPixel.xyz*FloatToVec3(Attr.y))/(LastPixel.w+1.),min(64.,LastPixel.w+1.));
        } else {
            Output = vec4(FloatToVec3(Attr.x)*LightCoeff,1.);
        }
    }
    fragColor = Output;
}
