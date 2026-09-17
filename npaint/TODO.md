Sorted by priority:

# Features:

Change mirror axis via ruler? UX requires thought

Photo / Pixel Art / Vector mode split?

Content-aware fill
Multi-scale PatchMatch: pyramid, and at each level an EM loop of
nearest-neighbour patch search then vote. Pure function of pixels and a mask,
no dependencies, no model to download. Same nearest-neighbour field is what a
patch tool would run on, so it is the next thing after the healing brush.
Speed is the risk, not the algorithm — single-threaded wasm, no
SharedArrayBuffer. Cap the working resolution, restrict the search to a
dilated band round the hole, and abandon a patch compare once its running
error beats the best. Good on texture, wrong on structure; that is the
ceiling of every non-generative method.

Clipping masks
Clip a layer to the one below. A flag on Layer and a branch in the
compositor. Wanted the first time an adjustment layer should only reach one
layer.

Writing .psd
psd.rs only loads. Layers and masks alone would make the format two-way.

Layer effects
Drop shadow, stroke, outer glow as a non-destructive per-layer struct. Text
already knows outline and shadow; layers do not.

Pen tool and paths
Prerequisite for the vector mode above, but the UX of Bezier editing is hard
to get right and easy to get wrong.
