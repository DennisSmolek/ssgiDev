SSGI node docs and source link:
https://threejs.org/docs/#SSGINode

First thread with ThreeJS version
https://github.com/mrdoob/three.js/issues/29668

Some notable comments:
https://github.com/mrdoob/three.js/issues/29668#issuecomment-2449626270
https://github.com/mrdoob/three.js/issues/29668#issuecomment-2446623827
https://github.com/mrdoob/three.js/issues/29668#issuecomment-2452357235
Says it cuts in half: https://github.com/mrdoob/three.js/issues/29668#issuecomment-2464354938

THread of the node itself: https://github.com/mrdoob/three.js/pull/31839
This comment from the later shadertoy author about GT-VBGI being better:https://github.com/mrdoob/three.js/pull/31839#issuecomment-3271661398
And Mugen saying his port is very basic:
https://github.com/mrdoob/three.js/pull/31839#issuecomment-3271711084
And the follow up about the shadertoy version:
https://github.com/mrdoob/three.js/pull/31839#issuecomment-3271862750


Shadertoys:
Screen Space Horizon GI: https://www.shadertoy.com/view/dsGBzW
Notes: renders super clean
GT-VBAO very capable version with many options and controls: https://www.shadertoy.com/view/wc2SzR
Also links to:
 Related/Sources:
    
        - GT-VBAO [Dist. Light Sampling 2]: https://www.shadertoy.com/view/wc2SzR
          -> alternative approach to distant light sampling for GT-VBAO that is designed to efficiently 
             evaluate distant light functions build from spherical caps of constant colors.
          
        - Slice-Rel Dir Mapping [GT-VBAO]: https://www.shadertoy.com/view/wcsXDN
        
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
          
          
        - Horizon Based Indirect Lighting (HBIL)
          https://github.com/Patapom/GodComplex/tree/master/Tests/TestHBIL 

Unity Base:
https://github.com/cdrinmatane/SSRT3

Blog of original Paper:
https://cdrinmatane.github.io/posts/ssaovb-code/

Blog of person taking it into their own engine: https://cybereality.com/screen-space-indirect-lighting-with-visibility-bitmask-improvement-to-gtao-ssao-real-time-ambient-occlusion-algorithm-glsl-shader-implementation/

Related tweets:
https://x.com/volfaze/status/1849437680506909016?s=46

https://x.com/Mirko_Salm/status/1833211198009184650