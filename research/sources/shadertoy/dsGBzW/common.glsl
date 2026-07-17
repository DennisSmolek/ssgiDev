// Shadertoy dsGBzW — Screen Space Horizon GI
// Author: Mathis (CC BY-NC-SA 3.0, Shadertoy default)
// Pass: Common
// Source: https://www.shadertoy.com/view/dsGBzW
// Captured live via Chrome (gShaderToy state) on 2026-07-17

//Settings
const float FOV = 0.6; //In radians

//Other vars
const float LightCoeff = 10.;
const float ILightCoeff = 1./LightCoeff;
const float CFOV = tan(FOV);
const float PI = 3.141592653;
const float HPI = 0.5*PI;
const float I6 = 1./6.;
const float I16 = 1./16.;
const float I32 = 1./32.;
const float I64 = 1./64.;
const float I300 = 1./300.;
const float I512 = 1./512.;
const float I1024 = 1./1024.;
#define RES iResolution.xy
#define IRES (1./iResolution.xy)
#define ASPECT vec2(iResolution.x/iResolution.y,1.)
struct HIT { float D; vec3 N; vec3 C; };

//LIGHT
vec3 SampleSky(vec3 d) {
    //Returns the sky color
    //vec3 SL = mix(vec3(0.2,0.5,1.),vec3(1.,0.2,0.025),d.x*0.5+0.5)*((1.-0.5*d.y)*0.5*pow(max(0.,d.y),0.5));
    vec3 SL = mix(vec3(0.2,0.5,1.),vec3(1.,0.2,0.025),d.x*0.5+0.5)*((1.-0.5*d.y)*0.5);
    //Return
    return SL;
}

//MATH
vec3 SchlickFresnel(vec3 r0, float angle) {
    //Return a Schlick Fresnel approximation
    return r0+(1.-r0)*pow(1.-angle,5.);
}

mat3 TBN(vec3 N) {
    //Returns the simple tangent space matrix
    vec3 Nb,Nt;
    if (abs(N.y)>0.999) {
        Nb = vec3(1.,0.,0.);
        Nt = vec3(0.,0.,1.);
    } else {
    	Nb = normalize(cross(N,vec3(0.,1.,0.)));
    	Nt = normalize(cross(Nb,N));
    }
    return mat3(Nb.x,Nt.x,N.x,Nb.y,Nt.y,N.y,Nb.z,Nt.z,N.z);
}

vec3 TBN(vec3 N, out vec3 O) {
    //Returns the simple tangent space directions
    if (abs(N.y)>0.999) {
        O = vec3(1.,0.,0.);
        return vec3(0.,0.,1.);
    } else {
        O = normalize(cross(N,vec3(0.,1.,0.)));
        return normalize(cross(O,N));
    }
}

vec3 RandSampleCos(vec2 v) {
    //Returns a random cos-distributed sample
    float theta = sqrt(v.x);
    float phi = 2.*3.14159*v.y;
    float x = theta*cos(phi);
    float z = theta*sin(phi);
    return vec3(x,z,sqrt(max(0.,1.-v.x)));
}

vec3 FloatToVec3(float v) {
    //Returns vec3 from int
    int VPInt = floatBitsToInt(v);
    int VPInt1024 = VPInt%1024;
    int VPInt10241024 = ((VPInt-VPInt1024)/1024)%1024;
    return vec3(VPInt1024,VPInt10241024,((VPInt-VPInt1024-VPInt10241024)/1048576))*I1024;
}

float Vec3ToFloat(vec3 v) {
    //Returns "int" from vec3 (10 bit per channel)
    ivec3 intv = min(ivec3(floor(v*1024.)),ivec3(1023));
    return intBitsToFloat(intv.x+intv.y*1024+intv.z*1048576);
}

vec2 FloatToVec2(float v) {
    //Returns vec3 from int
    int VPInt = floatBitsToInt(v);
    int VPInt16k = VPInt%1048576;
    return vec2(VPInt16k,((VPInt-VPInt16k)/1048576)%1048576);
}

float Vec2ToFloat(vec2 v) {
    //Returns "int" from vec3 (10 bit per channel)
    ivec2 intv = min(ivec2(floor(v*1048576.)),ivec2(1048575));
    return intBitsToFloat(intv.x+intv.y*1048576);
}

vec2 ABox(vec2 origin, vec2 idir, vec2 bmin, vec2 bmax) {
    //Returns near/far for box
    vec2 tMin = (bmin-origin)*idir;
    vec2 tMax = (bmax-origin)*idir;
    vec2 t1 = min(tMin,tMax);
    vec2 t2 = max(tMin,tMax);
    return vec2(max(t1.x,t1.y),min(t2.x,t2.y));
}

vec2 ABox(vec3 origin, vec3 idir, vec3 bmin, vec3 bmax) {
    //Returns near/far for box
    vec3 tMin = (bmin-origin)*idir;
    vec3 tMax = (bmax-origin)*idir;
    vec3 t1 = min(tMin,tMax);
    vec3 t2 = max(tMin,tMax);
    return vec2(max(max(t1.x,t1.y),t1.z),min(min(t2.x,t2.y),t2.z));
}

float ABoxfar(vec2 origin, vec2 idir, vec2 bmin, vec2 bmax) {
    //Returns far for box
    vec2 tMin = (bmin-origin)*idir;
    vec2 tMax = (bmax-origin)*idir;
    vec2 t2 = max(tMin,tMax);
    return min(t2.x,t2.y);
}

float ABoxfar(vec3 origin, vec3 idir, vec3 bmin, vec3 bmax) {
    //Returns far for box
    vec3 tMin = (bmin-origin)*idir;
    vec3 tMax = (bmax-origin)*idir;
    vec3 t2 = max(tMin,tMax);
    return min(min(t2.x,t2.y),t2.z);
}

vec2 ABoxfarNormal(vec2 origin, vec2 idir, vec2 bmin, vec2 bmax, out float dist) {
    //Returns far normal, far distance as out
    vec2 tMin = (bmin-origin)*idir;
    vec2 tMax = (bmax-origin)*idir;
    vec2 t2 = max(tMin,tMax);
    dist = min(t2.x,t2.y);
    vec2 signdir = (max(vec2(0.),sign(idir))*2.-1.);
    if (t2.x<t2.y) return vec2(signdir.x,0.);
    else return vec2(0.,signdir.y);
}

vec3 ABoxfarNormal(vec3 origin, vec3 idir, vec3 bmin, vec3 bmax, out float dist) {
    //Returns far normal, far distance as out
    vec3 tMin = (bmin-origin)*idir;
    vec3 tMax = (bmax-origin)*idir;
    vec3 t2 = max(tMin,tMax);
    dist = min(min(t2.x,t2.y),t2.z);
    vec3 signdir = (max(vec3(0.),sign(idir))*2.-1.);
    if (t2.x<min(t2.y,t2.z)) return vec3(signdir.x,0.,0.);
    else if (t2.y<t2.z) return vec3(0.,signdir.y,0.);
    else return vec3(0.,0.,signdir.z);
}

vec2 ABoxNormal(vec3 origin, vec3 idir, vec3 bmin, vec3 bmax, out vec3 N) {
    //Returns near/far, near normal as out
    vec3 tMin = (bmin-origin)*idir;
    vec3 tMax = (bmax-origin)*idir;
    vec3 t1 = min(tMin,tMax);
    vec3 t2 = max(tMin,tMax);
    vec3 signdir = -(max(vec3(0.),sign(idir))*2.-1.);
    if (t1.x>max(t1.y,t1.z)) N = vec3(signdir.x,0.,0.);
    else if (t1.y>t1.z) N = vec3(0.,signdir.y,0.);
    else N = vec3(0.,0.,signdir.z);
    return vec2(max(max(t1.x,t1.y),t1.z),min(min(t2.x,t2.y),t2.z));
}

vec3 ABoxNormal(vec3 origin, vec3 idir, vec3 bmin, vec3 bmax) {
    //Returns near normal
    vec3 tMin = (bmin-origin)*idir;
    vec3 tMax = (bmax-origin)*idir;
    vec3 t1 = min(tMin,tMax);
    vec3 t2 = max(tMin,tMax);
    vec3 signdir = -(max(vec3(0.),sign(idir))*2.-1.);
    if (t1.x>max(t1.y,t1.z)) return vec3(signdir.x,0.,0.);
    else if (t1.y>t1.z) return vec3(0.,signdir.y,0.);
    else return vec3(0.,0.,signdir.z);
}

vec4 ABoxXZ(vec3 P, vec3 D, vec3 BMin, vec3 BSize, vec3 XP, vec3 XN, vec3 ZP, vec3 ZN) {
    //Returns the nearest distance to the twisted box (flat horisonal surfaces)
    vec3 PXP = BMin+BSize*vec3(1.,0.5,0.5);
    vec3 PXN = BMin+BSize*vec3(0.,0.5,0.5);
    vec3 PZP = BMin+BSize*vec3(0.5,0.5,1.);
    vec3 PZN = BMin+BSize*vec3(0.5,0.5,0.);
    vec4 dots = vec4(dot(XP,D),dot(XN,D),dot(ZP,D),dot(ZN,D));
    vec4 dists = vec4(-dot(P-PXP,XP)/dots.x,-dot(P-PXN,XN)/dots.y,-dot(P-PZP,ZP)/dots.z,-dot(P-PZN,ZN)/dots.w);
    vec3 N;
    if (dots.x<0.) {
        vec3 ip = P+D*dists.x;
        if (max(dot(ip-PXN,XN),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(XP),dists.x);
    }
    if (dots.y<0.) {
        vec3 ip = P+D*dists.y;
        if (max(dot(ip-PXP,XP),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(XN),dists.y);
    }
    if (dots.z<0.) {
        vec3 ip = P+D*dists.z;
        if (max(dot(ip-PZN,ZN),max(dot(ip-PXP,XP),dot(ip-PXN,XN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(ZP),dists.z);
    }
    if (dots.w<0.) {
        vec3 ip = P+D*dists.w;
        if (max(dot(ip-PZP,ZP),max(dot(ip-PXP,XP),dot(ip-PXN,XN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(ZN),dists.w);
    }
    //No hit
    return vec4(-1.);
}

vec4 ABoxXZTopBottom(vec3 P, vec3 D, vec3 BMin, vec3 BSize, vec3 XP, vec3 XN, vec3 ZP, vec3 ZN) {
    //Returns the nearest distance to the twisted box (flat horisonal surfaces)
    vec3 PXP = BMin+BSize*vec3(1.,0.5,0.5);
    vec3 PXN = BMin+BSize*vec3(0.,0.5,0.5);
    vec3 PZP = BMin+BSize*vec3(0.5,0.5,1.);
    vec3 PZN = BMin+BSize*vec3(0.5,0.5,0.);
    vec4 dots = vec4(dot(XP,D),dot(XN,D),dot(ZP,D),dot(ZN,D));
    vec4 dists = vec4(-dot(P-PXP,XP)/dots.x,-dot(P-PXN,XN)/dots.y,-dot(P-PZP,ZP)/dots.z,-dot(P-PZN,ZN)/dots.w);
    vec3 N;
    if (dots.x<0.) {
        vec3 ip = P+D*dists.x;
        if (max(dot(ip-PXN,XN),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(XP),dists.x);
    }
    if (dots.y<0.) {
        vec3 ip = P+D*dists.y;
        if (max(dot(ip-PXP,XP),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(XN),dists.y);
    }
    if (dots.z<0.) {
        vec3 ip = P+D*dists.z;
        if (max(dot(ip-PZN,ZN),max(dot(ip-PXP,XP),dot(ip-PXN,XN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(ZP),dists.z);
    }
    if (dots.w<0.) {
        vec3 ip = P+D*dists.w;
        if (max(dot(ip-PZP,ZP),max(dot(ip-PXP,XP),dot(ip-PXN,XN)))<0. && ip.y>BMin.y && ip.y<BMin.y+BSize.y)
            return vec4(normalize(ZN),dists.w);
    }
    //Flat surfaces
    float rpy = P.y-BMin.y-BSize.y;
    if (max(-rpy,D.y)<0.) {
        vec3 ip = P-D*(rpy/D.y);
        if (max(max(dot(ip-PXP,XP),dot(ip-PXN,XN)),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0.) return vec4(0.,1.,0.,-rpy/D.y);
    }
    rpy = P.y-BMin.y;
    if (max(rpy,-D.y)<0.) {
        vec3 ip = P-D*(rpy/D.y);
        if (max(max(dot(ip-PXP,XP),dot(ip-PXN,XN)),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0.) return vec4(0.,-1.,0.,-rpy/D.y);
    }
    //No hit
    return vec4(-1.);
}

vec4 ABoxXY(vec3 P, vec3 D, vec3 BMin, vec3 BSize, vec3 XP, vec3 XN, vec3 YP, vec3 YN) {
    //Returns the nearest distance to the twisted box (flat horisonal surfaces)
    vec3 PXP = BMin+BSize*vec3(1.,0.5,0.5);
    vec3 PXN = BMin+BSize*vec3(0.,0.5,0.5);
    vec3 PYP = BMin+BSize*vec3(0.5,1.,0.5);
    vec3 PYN = BMin+BSize*vec3(0.5,0.,0.5);
    vec4 dots = vec4(dot(XP,D),dot(XN,D),dot(YP,D),dot(YN,D));
    vec4 dists = vec4(-dot(P-PXP,XP)/dots.x,-dot(P-PXN,XN)/dots.y,-dot(P-PYP,YP)/dots.z,-dot(P-PYN,YN)/dots.w);
    vec3 N;
    if (dots.x<0.) {
        vec3 ip = P+D*dists.x;
        if (max(dot(ip-PXN,XN),max(dot(ip-PYP,YP),dot(ip-PYN,YN)))<0. && ip.z>BMin.z && ip.z<BMin.z+BSize.z)
            return vec4(normalize(XP),dists.x);
    }
    if (dots.y<0.) {
        vec3 ip = P+D*dists.y;
        if (max(dot(ip-PXP,XP),max(dot(ip-PYP,YP),dot(ip-PYN,YN)))<0. && ip.z>BMin.z && ip.z<BMin.z+BSize.z)
            return vec4(normalize(XN),dists.y);
    }
    if (dots.z<0.) {
        vec3 ip = P+D*dists.z;
        if (max(dot(ip-PYN,YN),max(dot(ip-PXP,XP),dot(ip-PXN,XN)))<0. && ip.z>BMin.z && ip.z<BMin.z+BSize.z)
            return vec4(normalize(YP),dists.z);
    }
    if (dots.w<0.) {
        vec3 ip = P+D*dists.w;
        if (max(dot(ip-PYP,YP),max(dot(ip-PXP,XP),dot(ip-PXN,XN)))<0. && ip.z>BMin.z && ip.z<BMin.z+BSize.z)
            return vec4(normalize(YN),dists.w);
    }
    //Flat surfaces
    float rpy = P.y-BMin.y-BSize.y;
    if (max(-rpy,D.y)<0.) {
        vec3 ip = P-D*(rpy/D.y);
        //if (max(max(dot(ip-PXP,XP),dot(ip-PXN,XN)),max(dot(ip-PZP,ZP),dot(ip-PZN,ZN)))<0.) return vec4(0.,1.,0.,-rpy/D.y);
    }
    //No hit
    return vec4(-1.);
}

float ARand21(vec2 uv) {
    //Returns 1D noise from 2D
    return fract(sin(uv.x*uv.y)*403.125+cos(dot(uv,vec2(13.18273,51.2134)))*173.137);
}

float ARand31(vec3 uv) {
    //Returns 1D noise from 3D
    return fract(sin(uv.x*uv.y+uv.z*uv.y*uv.x)*403.125+cos(dot(uv,vec3(33.1256,13.18273,51.2134)))*173.137);
}

vec3 ARand23(vec2 uv) {
    //Analytic 3D noise from 2D
    return fract(sin(uv.x*uv.y)*vec3(403.125,486.125,513.432)+cos(dot(uv,vec2(13.18273,51.2134)))*vec3(173.137,261.23,203.127));
}

//SDF
float DFBox(vec3 p, vec3 b) {
    vec3 d = abs(p-b*0.5)-b*0.5;
    return min(max(d.x,max(d.y,d.z)),0.)+length(max(d,0.));
}

float DFBoxC(vec3 p, vec3 b) {
    vec3 d = abs(p)-b;
    return min(max(d.x,max(d.y,d.z)),0.)+length(max(d,0.));
}

float DFBox(vec2 p, vec2 b) {
    vec2 d = abs(p-b*0.5)-b*0.5;
    return min(max(d.x,d.y),0.)+length(max(d,0.));
}

float DFBoxC(vec2 p, vec2 b) {
    vec2 d = abs(p)-b;
    return min(max(d.x,d.y),0.)+length(max(d,0.));
}

float DFDisk(vec3 p) {
    float d = length(p.xz-0.5)-0.35;
    vec2 w = vec2(d,abs(p.y));
    return min(max(w.x,w.y),0.)+length(max(w,0.));
}

HIT Trace(vec3 P, vec3 D, float Time) {
    HIT OUT = HIT(1000000.,vec3(-1.),vec3(-1.));
    vec3 ID = 1./D; vec3 N; vec4 sd;
    
    //Flat floor
    if (D.y<0. && P.y>0.) {
        OUT = HIT(-P.y/D.y,vec3(0.,1.,0.),vec3(0.99));
    }
    
    //Wall not window
    vec2 bb = ABoxNormal(P,ID,vec3(3.,0.,0.),vec3(3.1,3.,3.),N);
    if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,vec3(1.));
    
    
    
    //Wall window
    bb = ABox(P,ID,vec3(0.,0.,2.8),vec3(3.1,2.8,3.1));
    if (DFBox(P-vec3(0.,0.,2.8),vec3(3.1,2.8,0.3))<0. || (bb.x>0. && bb.y>bb.x && bb.x<OUT.D)) {
        //Emissive windows
        bb = ABoxNormal(P,ID,vec3(0.05,0.,3.),vec3(2.9,2.2,3.1),N);
        vec3 Emissive = mix(mix(vec3(3.,2.,2.),vec3(4.,0.4,0.1),
                        float(P.x+D.x*bb.x>2.)),vec3(1.3,1.,4.),float(P.x+D.x*bb.x<1.));
        Emissive = mix(Emissive,vec3(1.),float(P.y+D.y*bb.x>1.25 && abs(P.x+D.x*bb.x-1.5)<0.5));
        if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,Emissive);
        //Window frames
        sd = ABoxXZ(P,D,vec3(0.,0.,2.9),vec3(0.225,2.8,0.2),
                        vec3(1.,-0.1,-0.02),vec3(-1.,0.,0.),vec3(0.,0.,1.),vec3(-0.4,0.015,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZ(P,D,vec3(0.9,0.,2.9),vec3(0.3,2.8,0.2),
                        vec3(1.,-0.03,-0.1),vec3(-1.,-0.02,-0.25),vec3(0.,0.,1.),vec3(0.2,0.015,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZ(P,D,vec3(1.8,0.,2.9),vec3(0.35,2.8,0.2),
                        vec3(1.,0.04,0.1),vec3(-1.,0.08,0.25),vec3(0.,0.,1.),vec3(0.2,0.015,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZ(P,D,vec3(2.8,0.,2.9),vec3(0.2,2.8,0.2),
                        vec3(1.,0.,0.),vec3(-1.,-0.04,-0.02),vec3(0.,0.,1.),vec3(-0.4,0.015,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
    }
    
    
    
    //Twisted wall over
    bb = ABox(P,ID,vec3(0.,2.2,2.),vec3(3.1,3.,3.1));
    if (DFBox(P-vec3(0.,2.2,2.),vec3(3.1,0.8,1.1))<0. || (bb.x>0. && bb.y>bb.x && bb.x<OUT.D)) {
        //Wall behind
        sd = ABoxXZTopBottom(P,D,vec3(0.,2.2,2.7),vec3(3.,0.8,0.4),
                        vec3(1.,0.,0.),vec3(-1.,0.,0.),vec3(0.,0.,1.),vec3(0.,-0.707,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
    }
    
    
    
    //Floor boards
    for (float xi = 0.; xi<5.; xi++) {
        bb = ABox(P,ID,vec3(xi*0.63-0.03,0.,0.),vec3(xi*0.63+0.8,0.05,3.1));
        if (DFBox(P-vec3(xi*0.6,0.,0.),vec3(0.8,0.05,3.1))<0. || (bb.x>0. && bb.y>bb.x && bb.x<OUT.D)) {
            sd = ABoxXY(P,D,vec3(xi*0.63,0.,0.05),vec3(0.2,0.03,3.05),
                            vec3(1.,0.8,-0.01),vec3(-1.,1.6,-0.01),vec3(-0.01,1.,-0.005),vec3(0.,-1.,0.));
            if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
            sd = ABoxXY(P,D,vec3(xi*0.63+0.21,0.,0.05),vec3(0.2,0.03,3.05),
                            vec3(1.,0.75,-0.005),vec3(-1.,0.75,0.),vec3(-0.01,1.,-0.005),vec3(0.,-1.,0.));
            if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
            sd = ABoxXY(P,D,vec3(xi*0.63+0.42,0.,0.05),vec3(0.2,0.03,3.05),
                            vec3(1.,0.8,0.),vec3(-1.,0.75,0.),vec3(-0.09,1.,0.0025),vec3(0.,-1.,0.));
            if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        }
    }
    
    
    
    //Table
    vec3 RP = P-vec3(0.1,0.,1.25);
    bb = ABox(RP,ID,vec3(0.,0.,0.),vec3(0.75,0.5,0.75));
    if (DFBox(RP,vec3(0.75,0.5,0.75))<0. || (bb.x>0. && bb.y>bb.x && bb.x<OUT.D)) {
        //Legs
        sd = ABoxXZ(RP,D,vec3(0.15,0.,0.15),vec3(0.05,0.45,0.05),
                    vec3(1.,0.07,-0.15),vec3(-1.,0.03,0.3),vec3(-0.5,0.02,1.),vec3(0.3,0.07,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZ(RP,D,vec3(0.55,0.,0.325),vec3(0.05,0.45,0.05),
                    vec3(1.,-0.07,-0.15),vec3(-1.,-0.01,0.3),vec3(-0.5,-0.02,1.),vec3(0.3,0.07,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZ(RP,D,vec3(0.25,0.,0.55),vec3(0.05,0.45,0.05),
                    vec3(1.,0.01,-0.15),vec3(-1.,0.01,0.3),vec3(-0.5,0.02,1.),vec3(0.3,-0.07,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        //Table
        sd = ABoxXZTopBottom(RP,D,vec3(0.07,0.45,0.1),vec3(0.6,0.025,0.55),
                    vec3(1.,0.8,0.15),vec3(-1.,0.8,0.5),vec3(0.6,0.8,1.),vec3(-0.1,0.8,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
    }
    
    
    
    //Boxes
    sd = ABoxXZTopBottom(P,D,vec3(0.05,0.,2.3),vec3(0.45),
                vec3(1.,0.,-0.6),vec3(-1.,0.,0.6),vec3(0.6,0.,1.),vec3(-0.6,0.,-1.));
    if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZTopBottom(P,D,vec3(-0.1,0.45,2.2),vec3(0.7,0.45,0.7),
                    vec3(1.,0.,-1.6),vec3(-1.,0.,1.6),vec3(1.6,0.,1.),vec3(-1.6,0.,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
    
    //Wall boo
    bb = ABoxNormal(P,ID,vec3(2.8,1.,1.),vec3(3.,1.05,2.),N);
    if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,vec3(1.));
        bb = ABoxNormal(P,ID,vec3(2.8,1.3,1.1),vec3(3.,1.35,2.1),N);
        if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,vec3(1.));
            bb = ABoxNormal(P,ID,vec3(2.8,1.65,1.2),vec3(3.,1.7,2.3),N);
            if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,vec3(1.));
        bb = ABoxNormal(P,ID,vec3(2.85,1.,1.575),vec3(3.,1.65,1.625),N);
        if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,vec3(1.));
    
    
    
    //Wall cupb
    sd = ABoxXZTopBottom(P,D,vec3(2.6,2.,0.4),vec3(0.4,0.6,0.4),
                vec3(1.,0.,0.),vec3(-1.,-0.3,0.),vec3(0.,-0.05,1.),vec3(0.,-0.15,-1.));
    if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
    
    
    
    //Desk
    bb = ABoxNormal(P,ID,vec3(2.4,0.6,1.),vec3(3.,0.65,2.5),N);
    if (bb.x>0. && bb.y>bb.x && bb.x<OUT.D) OUT = HIT(bb.x,N,vec3(1.));
        sd = ABoxXZTopBottom(P,D,vec3(2.5,0.,1.1),vec3(0.5,0.6,0.3),
                vec3(1.,0.,0.),vec3(-1.,-0.3,0.),vec3(0.,-0.05,1.),vec3(0.,-0.15,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
        sd = ABoxXZTopBottom(P,D,vec3(2.45,0.,2.35),vec3(0.1,0.6,0.05),
                vec3(1.,0.,0.),vec3(-1.,-0.,0.),vec3(0.,0.,1.),vec3(0.,0.,-1.));
        if (sd.w>0. && sd.w<OUT.D) OUT = HIT(sd.w,sd.xyz,vec3(1.));
    
    
    
    //Textured vertical planes
    if (sign(D.z*(P.z-0.9))<0.) {
        float t = -(P.z-0.9)/D.z;
        vec3 sp = P+D*t;
        if (t<OUT.D && DFBox(sp.xy-vec2(2.5,0.),vec2(0.5,1.7))<0. &&
            (sin((sp.x-2.5)*27.-1.9)*0.5+0.5)*(sin(sp.y*27.)*0.5+0.5)<0.5) {
            OUT = HIT(t,vec3(0.,0.,-sign(D.z)),vec3(1.));
        }
    }
    if (sign(D.z*(P.z-0.3))<0.) {
        float t = -(P.z-0.3)/D.z;
        vec3 sp = P+D*t;
        if (t<OUT.D && DFBox(sp.xy-vec2(2.5,0.),vec2(0.5,1.7))<0. &&
            (sin((sp.x-2.5)*27.-1.9)*0.5+0.5)*(sin(sp.y*27.)*0.5+0.5)<0.5) {
            OUT = HIT(t,vec3(0.,0.,-sign(D.z)),vec3(1.));
        }
    }
    
    
    
    //Textured wall plane
    if (D.x>0. && P.x<2.975) {
        float t = -(P.x-2.975)/D.x;
        vec3 sp = P+D*t;
        if (t<OUT.D && DFBox(sp.zy,vec2(3.))<0. &&
            (sin(sp.z*33.-1.)*0.5+0.5)*(sin(sp.y*33.-0.25)*0.5+0.5)<0.4) {
            OUT = HIT(t,vec3(-1.,0.,0.),vec3(1.,0.4,0.05));
        }
    }
    
    
    
    //Texture floor plane
    if (D.y<0.) {
        float t = -(P.y-0.06)/D.y;
        vec3 sp = P+D*t;
        if (t<OUT.D && DFBox(sp.xz-vec2(1.,0.325),vec2(1.,2.5))<0. &&
            (sin(sp.x*33.)*0.5+0.5)*(sin(sp.z*33.)*0.5+0.5)<0.4) {
            float z = (P.z+D.z*t)*0.34;
            OUT = HIT(t,vec3(0.,1.,0.),mix(vec3(1.),vec3(0.1,1.,0.1),z*z*(3.-2.*z)));
        }
    }
    
    
    
    return OUT;
}
