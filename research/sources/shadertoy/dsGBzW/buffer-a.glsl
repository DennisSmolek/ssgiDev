// Shadertoy dsGBzW — Screen Space Horizon GI
// Author: Mathis (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Buffer A
// Source: https://www.shadertoy.com/view/dsGBzW
// Captured live via Chrome (gShaderToy state) on 2026-07-17

//G-Buffer

void UpdateMouse(inout vec4 Output, vec4 Mouse) {
    //Updates the mouse
    if (Mouse.z>0.) {
        if (Output.w==0.) {
            Output.w = 1.;
            Output.xy = Mouse.zw;
        }
    } else Output.w = 0.;
}

void UpdateEye(inout vec4 Output, vec4 CMouse, vec4 Mouse) {
    //Updates the eye vector
    if (CMouse.w==0.) {
        //Simple animation
        float ExpTime = iTime*(1.-exp(-iTime*0.1));
        float y = 0.05+(sin(ExpTime*0.5)*0.5+0.5);
        float x = -0.1-0.8*(sin(ExpTime*0.2+0.4)*0.5+0.5);
        float len = length(Output.xy-vec2(x,y));
        if (len>0.) Output.xy += normalize(vec2(x,y)-Output.xy)*clamp(iTimeDelta/(len*len+0.001),0.,len);
        Output.zw = Output.xy;
    } else {
        //Y led
        Output.x = Output.z+(Mouse.y-CMouse.y)*IRES.y*3.;
        Output.x = clamp(Output.x,-1.,-0.025);
        //X led
        Output.y = Output.w-(Mouse.x-CMouse.x)*IRES.x*10.;
        Output.y = clamp(Output.y,0.05,2.);
    }
}

vec4 SampleMB(vec2 uv, vec3 PPos, vec3 Normal, vec3 LPos, mat3 LEyeMat, out float Weight) {
    //A weighted sample for a bilinear mix
    vec2 ClampedUV = clamp(uv,vec2(1.5),RES-0.5);
    vec4 C = texture(iChannel0,ClampedUV*IRES);
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
    vec4 Output = texture(iChannel0,fragCoord.xy*IRES);
    if (iFrame==0) {
        //Initialization
        if (fragCoord.x<10. && fragCoord.y<1.) { //Store vars
            if (fragCoord.x<1.) Output = vec4(0.,0.,0.,0.); //Mouse
            else if (fragCoord.x<2.) Output = vec4(-0.7,0.5,0.,0.); //Player Eye (Angles)
            else if (fragCoord.x<3.) Output = vec4(0.,0.,0.,1.); //Player Eye (Vector)
            else if (fragCoord.x<4.) Output = vec4(-0.1,3.4,-1.,1.); //Player Pos
            else if (fragCoord.x<5.) Output = vec4(0.5,3.5,0.,0.); //Sun angles
            else if (fragCoord.x<6.) Output = vec4(0.,0.,0.,0.); //Sun direction
        }
    } else {
        //Update
		if (fragCoord.x<16. && fragCoord.y<1.) {
            //Update vars
            if (fragCoord.x<1.) { //Mouse
                UpdateMouse(Output,iMouse);
            } else if (fragCoord.x<2.) {
                //Player Eye (Angles)
                vec4 CMouse = texture(iChannel0,vec2(0.5,0.5)*IRES);
                UpdateMouse(CMouse,iMouse);
                UpdateEye(Output,CMouse,iMouse);
            } else if (fragCoord.x<3.) {
                //Player Eye (Vector)
                vec4 A4 = texture(iChannel0,vec2(1.5,0.5)*IRES);
                vec4 CMouse = texture(iChannel0,vec2(0.5,0.5)*IRES);
                UpdateMouse(CMouse,iMouse);
                UpdateEye(A4,CMouse,iMouse);
                Output.xyz = normalize(vec3(cos(A4.x)*sin(A4.y),sin(A4.x),cos(A4.x)*cos(A4.y)));
            } else if (fragCoord.x<4.) {
                //Player Pos
                float Speed = iTimeDelta;
                if (texelFetch(iChannel1,ivec2(32,0),0).x>0.) Speed = 8.*iTimeDelta;
                //Update eye
                vec4 CMouse = texture(iChannel0,vec2(0.5,0.5)*IRES);
                UpdateMouse(CMouse,iMouse);
                vec4 Eye4 = texture(iChannel0,vec2(1.5,0.5)*IRES);
                UpdateEye(Eye4,CMouse,iMouse);
                vec3 Eye = vec3(cos(Eye4.x)*sin(Eye4.y),sin(Eye4.x),cos(Eye4.x)*cos(Eye4.y));
                Output.xyz = vec3(1.5,1.,1.75)-Eye*4.;
            } else if (fragCoord.x<5.) {
                //Sun angle
                if (texelFetch(iChannel1,ivec2(77,0),0).x>0.) Output.y += iTimeDelta;
                if (texelFetch(iChannel1,ivec2(78,0),0).x>0.) Output.y -= iTimeDelta;
            } else if (fragCoord.x<6.) {
                //Sun direction
                vec2 Angles = texture(iChannel0,vec2(4.5,0.5)*IRES).xy;
                Output = vec4(normalize(vec3(cos(Angles.y)*cos(Angles.x)
                	,sin(Angles.x),sin(Angles.y)*cos(Angles.x))),1.);
            } else if (fragCoord.x<7.) {
                //Last frame dir
                Output = texture(iChannel0,vec2(2.5,0.5)*IRES);
            } else if (fragCoord.x<8.) {
                //Last frame position
                Output = texture(iChannel0,vec2(3.5,0.5)*IRES);
            } else if (fragCoord.x<9.) {
                //Last frame SunDir
                Output = texture(iChannel0,vec2(5.5,0.5)*IRES);
            }
        }
    }
    if (DFBox(fragCoord-1.,RES)<0.) {
        Output = vec4(0.);
        //G-Buffer
        float CurrentFrame = float(iFrame);
        vec2 SSOffset = vec2(0.);
        //Compensate for 1 frame lag
        vec3 LastPos = texture(iChannel0,vec2(3.5,0.5)*IRES).xyz;
        vec4 CMouse = texture(iChannel0,vec2(0.5,0.5)*IRES);
        UpdateMouse(CMouse,iMouse);
        vec4 Eye4 = texture(iChannel0,vec2(1.5,0.5)*IRES);
        vec3 LastEye = normalize(vec3(cos(Eye4.x)*sin(Eye4.y),sin(Eye4.x),cos(Eye4.x)*cos(Eye4.y)));
        UpdateEye(Eye4,CMouse,iMouse);
        vec3 Eye = vec3(cos(Eye4.x)*sin(Eye4.y),sin(Eye4.x),cos(Eye4.x)*cos(Eye4.y));
        vec3 Pos = vec3(1.5,1.,1.75)-Eye*4.;
        mat3 EyeMat = TBN(Eye);
        vec3 Dir = normalize(vec3(((fragCoord+SSOffset)*IRES*2.-1.)*(ASPECT*CFOV),1.)*EyeMat);
        //Render scene
        HIT Pixel = Trace(Pos,Dir,iTime);
        if (Pixel.C.x>1.) {
            //Emissive
            Output = vec4(Vec3ToFloat(vec3(Pixel.C.x-1.,Pixel.C.yz)*ILightCoeff),-1.,Vec3ToFloat(Pixel.N*0.5+0.5),Pixel.D);
        } else if (Pixel.C.x>-0.5) {
            //Geometry
            vec3 PPos = Pos+Dir*Pixel.D+Pixel.N*0.0001;
            Output.w = Pixel.D;
            Output.z = Vec3ToFloat(Pixel.N*0.5+0.5);
            Output.y = Vec3ToFloat(Pixel.C);
            
            
            //Reprojection
            if (iFrame>1) {
                vec3 LastTan; vec3 LastBit = TBN(LastEye,LastTan);
                vec3 RPPos = PPos-LastPos;
                RPPos = vec3(dot(RPPos,LastTan),dot(RPPos,LastBit),dot(RPPos,LastEye));
                vec2 LastUV = (RPPos.xy/(RPPos.z*(ASPECT*CFOV)))*0.5+0.5;
                if (DFBox(LastUV*RES-1.,RES-1.)<0.) {
                    //Valid reprojection
                    float LastWeight;
                    vec4 LastPixel = ManualBilinear(LastUV*RES,PPos,Pixel.N,LastPos,TBN(LastEye),LastWeight);
                    Output.x = Vec3ToFloat(LastPixel.xyz*ILightCoeff);
                    if (LastWeight<0.01 || isnan(Output.x) || isinf(Output.x)) Output.x = 0.;
                }
            }
        } else {
            //Sky
            Output = vec4(0.,-2.,0.,100000.);
        }
    }
    fragColor = Output;
}
