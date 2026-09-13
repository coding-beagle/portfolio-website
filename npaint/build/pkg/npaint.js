export class NPaint {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NPaintFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_npaint_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    active_layer() {
        const ret = wasm.npaint_active_layer(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * A new adjustment layer above the active one, with `params` (as the
     * adjustment's dialog gives them; empty for neutral). Returns its index.
     * @param {string} name
     * @param {Float32Array} params
     * @returns {number}
     */
    add_adjustment_layer(name, params) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_add_adjustment_layer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @returns {number}
     */
    add_layer() {
        const ret = wasm.npaint_add_layer(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Adds a layer from straight-alpha RGBA bytes of the document's size —
     * what `getImageData` on a decoded image gives.
     * @param {string} name
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    add_layer_from_rgba(name, width, height, bytes) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_add_layer_from_rgba(this.__wbg_ptr, ptr0, len0, width, height, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Gives a layer a mask from the selection — revealing it, or hiding it
     * when `hide` is set — or one revealing everything when nothing is
     * selected.
     * @param {number} index
     * @param {boolean} hide
     */
    add_layer_mask(index, hide) {
        const ret = wasm.npaint_add_layer_mask(this.__wbg_ptr, index, hide);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {string[]}
     */
    static adjustment_names() {
        const ret = wasm.npaint_adjustment_names();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    antialias() {
        const ret = wasm.npaint_antialias(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Applies a parameterless adjustment (invert, desaturate) in one step.
     * @param {string} name
     * @returns {boolean}
     */
    apply_adjustment(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_apply_adjustment(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Bakes the mask into the layer and drops it.
     * @param {number} index
     */
    apply_layer_mask(index) {
        const ret = wasm.npaint_apply_layer_mask(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {string}
     */
    background() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_background(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    begin_adjustment() {
        const ret = wasm.npaint_begin_adjustment(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Opens an adjustment layer's settings as a session: `preview_adjustment`
     * then changes the layer live, and `commit_session` keeps it.
     * @param {number} index
     */
    begin_adjustment_layer(index) {
        const ret = wasm.npaint_begin_adjustment_layer(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    begin_transform() {
        const ret = wasm.npaint_begin_transform(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {boolean}
     */
    can_redo() {
        const ret = wasm.npaint_can_redo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    can_undo() {
        const ret = wasm.npaint_can_undo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    cancel_gesture() {
        const ret = wasm.npaint_cancel_gesture(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    cancel_session() {
        const ret = wasm.npaint_cancel_session(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    clear_selection() {
        const ret = wasm.npaint_clear_selection(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    color() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_color(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    commit_session() {
        const ret = wasm.npaint_commit_session(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} index
     */
    convert_to_smart_object(index) {
        const ret = wasm.npaint_convert_to_smart_object(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    deselect() {
        wasm.npaint_deselect(this.__wbg_ptr);
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    duplicate_layer(index) {
        const ret = wasm.npaint_duplicate_layer(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Why the current tool cannot paint on the active layer, or an empty
     * string when it can — the message the page shows when a click on the
     * canvas is declined.
     * @returns {string}
     */
    edit_refusal() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_edit_refusal(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    fill() {
        const ret = wasm.npaint_fill(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    fill_selection() {
        const ret = wasm.npaint_fill_selection(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    fill_selection_background() {
        const ret = wasm.npaint_fill_selection_background(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} view_w
     * @param {number} view_h
     */
    fit_to_view(view_w, view_h) {
        wasm.npaint_fit_to_view(this.__wbg_ptr, view_w, view_h);
    }
    flatten() {
        wasm.npaint_flatten(this.__wbg_ptr);
    }
    flip_canvas_horizontal() {
        wasm.npaint_flip_canvas_horizontal(this.__wbg_ptr);
    }
    flip_canvas_vertical() {
        wasm.npaint_flip_canvas_vertical(this.__wbg_ptr);
    }
    /**
     * @returns {boolean}
     */
    flip_layer_horizontal() {
        const ret = wasm.npaint_flip_layer_horizontal(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    flip_layer_vertical() {
        const ret = wasm.npaint_flip_layer_vertical(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The composite as a fresh byte array, for export.
     * @returns {Uint8Array}
     */
    frame_copy() {
        const ret = wasm.npaint_frame_copy(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    frame_len() {
        const ret = wasm.npaint_frame_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Pointer to the current frame's RGBA bytes. Only valid until the next
     * call into the module that could reallocate, which is why the page
     * re-reads it on every draw rather than keeping the view around.
     * @returns {number}
     */
    frame_ptr() {
        const ret = wasm.npaint_frame_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    has_session() {
        const ret = wasm.npaint_has_session(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    height() {
        const ret = wasm.npaint_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    is_adjusting() {
        const ret = wasm.npaint_is_adjusting(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_gesturing() {
        const ret = wasm.npaint_is_gesturing(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_transforming() {
        const ret = wasm.npaint_is_transforming(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The adjustment an adjustment layer applies, or an empty string.
     * @param {number} index
     * @returns {string}
     */
    layer_adjustment_name(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.npaint_layer_adjustment_name(this.__wbg_ptr, index);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Its parameters, in the order the dialog shows them.
     * @param {number} index
     * @returns {Float32Array}
     */
    layer_adjustment_params(index) {
        const ret = wasm.npaint_layer_adjustment_params(this.__wbg_ptr, index);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    layer_count() {
        const ret = wasm.npaint_layer_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Whether the tools are painting on the layer's mask rather than its
     * pixels.
     * @param {number} index
     * @returns {boolean}
     */
    layer_editing_mask(index) {
        const ret = wasm.npaint_layer_editing_mask(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {number} index
     * @returns {boolean}
     */
    layer_has_mask(index) {
        const ret = wasm.npaint_layer_has_mask(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    layer_id(index) {
        const ret = wasm.npaint_layer_id(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * `"pixels"`, `"adjustment"` or `"smart"`.
     * @param {number} index
     * @returns {string}
     */
    layer_kind(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.npaint_layer_kind(this.__wbg_ptr, index);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {number} index
     * @returns {boolean}
     */
    layer_mask_enabled(index) {
        const ret = wasm.npaint_layer_mask_enabled(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * The same for a layer's mask, as grey. Empty when it has no mask.
     * @param {number} index
     * @param {number} w
     * @param {number} h
     * @returns {Uint8Array}
     */
    layer_mask_thumbnail(index, w, h) {
        const ret = wasm.npaint_layer_mask_thumbnail(this.__wbg_ptr, index, w, h);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} index
     * @returns {string}
     */
    layer_name(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.npaint_layer_name(this.__wbg_ptr, index);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    layer_opacity(index) {
        const ret = wasm.npaint_layer_opacity(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * A small RGBA thumbnail of one layer's pixels, `w` by `h`,
     * nearest-neighbour. Transparent for an adjustment layer, which has none.
     * @param {number} index
     * @param {number} w
     * @param {number} h
     * @returns {Uint8Array}
     */
    layer_thumbnail(index, w, h) {
        const ret = wasm.npaint_layer_thumbnail(this.__wbg_ptr, index, w, h);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    layer_via_copy() {
        const ret = wasm.npaint_layer_via_copy(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} index
     * @returns {boolean}
     */
    layer_visible(index) {
        const ret = wasm.npaint_layer_visible(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @returns {number}
     */
    max_pixels() {
        const ret = wasm.npaint_max_pixels(this.__wbg_ptr);
        return ret;
    }
    /**
     * The biggest canvas the engine will make, for the page to clamp a drag
     * with rather than asking for something that cannot be allocated.
     * @returns {number}
     */
    max_side() {
        const ret = wasm.npaint_max_side(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} index
     */
    merge_down(index) {
        const ret = wasm.npaint_merge_down(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} from
     * @param {number} to
     */
    move_layer(from, to) {
        const ret = wasm.npaint_move_layer(this.__wbg_ptr, from, to);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * A new editor with a document of the given size. `background` is a hex
     * colour, or an empty string for a transparent canvas.
     * @param {number} width
     * @param {number} height
     * @param {string} background
     */
    constructor(width, height, background) {
        const ptr0 = passStringToWasm0(background, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_new(width, height, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        NPaintFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {string} background
     */
    new_document(width, height, background) {
        const ptr0 = passStringToWasm0(background, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_new_document(this.__wbg_ptr, width, height, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    opacity() {
        const ret = wasm.npaint_opacity(this.__wbg_ptr);
        return ret;
    }
    /**
     * Replaces the document with an image, as Open does. The bytes are
     * straight-alpha RGBA of `width` by `height`.
     * @param {string} name
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     */
    open_image(name, width, height, bytes) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_open_image(this.__wbg_ptr, ptr0, len0, width, height, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} dx
     * @param {number} dy
     */
    pan_by(dx, dy) {
        wasm.npaint_pan_by(this.__wbg_ptr, dx, dy);
    }
    /**
     * @returns {number}
     */
    pan_x() {
        const ret = wasm.npaint_pan_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    pan_y() {
        const ret = wasm.npaint_pan_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * Places an image as a smart object above the active layer, fitted to
     * the document and centred. The bytes are straight-alpha RGBA of
     * `width` by `height`, at whatever size the picture is.
     * @param {string} name
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    place_smart_object(name, width, height, bytes) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_place_smart_object(this.__wbg_ptr, ptr0, len0, width, height, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {boolean} shift
     * @param {boolean} alt
     * @returns {boolean}
     */
    pointer_down(x, y, shift, alt) {
        const ret = wasm.npaint_pointer_down(this.__wbg_ptr, x, y, shift, alt);
        return ret !== 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {boolean} shift
     * @param {boolean} alt
     * @returns {boolean}
     */
    pointer_move(x, y, shift, alt) {
        const ret = wasm.npaint_pointer_move(this.__wbg_ptr, x, y, shift, alt);
        return ret !== 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {boolean} shift
     * @param {boolean} alt
     * @returns {boolean}
     */
    pointer_up(x, y, shift, alt) {
        const ret = wasm.npaint_pointer_up(this.__wbg_ptr, x, y, shift, alt);
        return ret !== 0;
    }
    /**
     * Previews `name` with `params` (a Float32Array in the order the
     * adjustment's fields are declared) on the original pixels.
     * @param {string} name
     * @param {Float32Array} params
     */
    preview_adjustment(name, params) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(params, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_preview_adjustment(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     */
    rasterize_layer(index) {
        const ret = wasm.npaint_rasterize_layer(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {boolean}
     */
    redo() {
        const ret = wasm.npaint_redo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} index
     */
    remove_layer(index) {
        const ret = wasm.npaint_remove_layer(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     */
    remove_layer_mask(index) {
        const ret = wasm.npaint_remove_layer_mask(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     * @param {string} name
     */
    rename_layer(index, name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_rename_layer(this.__wbg_ptr, index, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Recomposites if anything changed since the last call. Returns whether
     * it did, so the page can skip the `putImageData`.
     * @returns {boolean}
     */
    render() {
        const ret = wasm.npaint_render(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Swaps a smart object's picture for another, keeping its place.
     * @param {number} index
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     */
    replace_smart_contents(index, width, height, bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_replace_smart_contents(this.__wbg_ptr, index, width, height, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    reset_colors() {
        wasm.npaint_reset_colors(this.__wbg_ptr);
    }
    /**
     * Resizes the canvas, keeping the current pixels at `(dx, dy)`.
     * @param {number} width
     * @param {number} height
     * @param {number} dx
     * @param {number} dy
     * @returns {boolean}
     */
    resize_canvas(width, height, dx, dy) {
        const ret = wasm.npaint_resize_canvas(this.__wbg_ptr, width, height, dx, dy);
        return ret !== 0;
    }
    /**
     * @param {number} turns
     */
    rotate_canvas(turns) {
        wasm.npaint_rotate_canvas(this.__wbg_ptr, turns);
    }
    /**
     * Quarter turns clockwise; negative for anticlockwise.
     * @param {number} turns
     * @returns {boolean}
     */
    rotate_layer(turns) {
        const ret = wasm.npaint_rotate_layer(this.__wbg_ptr, turns);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    sample_all_layers() {
        const ret = wasm.npaint_sample_all_layers(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    sample_mode() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_sample_mode(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `[x, y]` document coordinates for a screen position, for the status
     * bar's cursor readout.
     * @param {number} x
     * @param {number} y
     * @returns {Float64Array}
     */
    screen_to_doc(x, y) {
        const ret = wasm.npaint_screen_to_doc(this.__wbg_ptr, x, y);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    scrubby_zoom() {
        const ret = wasm.npaint_scrubby_zoom(this.__wbg_ptr);
        return ret !== 0;
    }
    select_all() {
        wasm.npaint_select_all(this.__wbg_ptr);
    }
    /**
     * @param {number} pixels
     * @returns {boolean}
     */
    select_contract(pixels) {
        const ret = wasm.npaint_select_contract(this.__wbg_ptr, pixels);
        return ret !== 0;
    }
    /**
     * @param {number} pixels
     * @returns {boolean}
     */
    select_expand(pixels) {
        const ret = wasm.npaint_select_expand(this.__wbg_ptr, pixels);
        return ret !== 0;
    }
    /**
     * @param {number} pixels
     * @returns {boolean}
     */
    select_feather(pixels) {
        const ret = wasm.npaint_select_feather(this.__wbg_ptr, pixels);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    select_invert() {
        const ret = wasm.npaint_select_invert(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Loads a layer's mask as the selection.
     * @param {number} index
     * @returns {boolean}
     */
    select_layer_mask(index) {
        const ret = wasm.npaint_select_layer_mask(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Selects everything one particular layer draws — Ctrl-clicking its
     * thumbnail — without making it the active layer.
     * @param {number} index
     * @returns {boolean}
     */
    select_layer_opaque(index) {
        const ret = wasm.npaint_select_layer_opaque(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * Selects the pixels the layer actually draws.
     * @returns {boolean}
     */
    select_opaque() {
        const ret = wasm.npaint_select_opaque(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Extends the selection to matching pixels anywhere in the image.
     * @returns {boolean}
     */
    select_similar() {
        const ret = wasm.npaint_select_similar(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} pixels
     * @returns {boolean}
     */
    select_smooth(pixels) {
        const ret = wasm.npaint_select_smooth(this.__wbg_ptr, pixels);
        return ret !== 0;
    }
    /**
     * Finds and selects the subject. False when there is nothing that stands
     * out enough to call one.
     * @returns {boolean}
     */
    select_subject() {
        const ret = wasm.npaint_select_subject(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Selects the subject from a matte the page worked out with the model:
     * `matte_w` x `matte_h` bytes of coverage, one per pixel, at whatever
     * resolution the model runs at.
     * @param {Uint8Array} matte
     * @param {number} matte_w
     * @param {number} matte_h
     * @returns {boolean}
     */
    select_subject_from_matte(matte, matte_w, matte_h) {
        const ptr0 = passArray8ToWasm0(matte, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_select_subject_from_matte(this.__wbg_ptr, ptr0, len0, matte_w, matte_h);
        return ret !== 0;
    }
    /**
     * How many pixels are selected.
     * @returns {number}
     */
    selection_area() {
        const ret = wasm.npaint_selection_area(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The marching ants as closed loops in document coordinates, flattened:
     * each loop is its point count followed by that many x, y pairs.
     * @returns {Float64Array}
     */
    selection_contours() {
        const ret = wasm.npaint_selection_contours(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * `[x, y, w, h]` in document pixels, or an empty array when nothing is
     * selected.
     * @returns {Int32Array}
     */
    selection_rect() {
        const ret = wasm.npaint_selection_rect(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} index
     */
    set_active_layer(index) {
        const ret = wasm.npaint_set_active_layer(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} on
     */
    set_antialias(on) {
        wasm.npaint_set_antialias(this.__wbg_ptr, on);
    }
    /**
     * @param {string} hex
     */
    set_background(hex) {
        const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_background(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} hex
     */
    set_color(hex) {
        const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_color(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} fill
     */
    set_fill(fill) {
        wasm.npaint_set_fill(this.__wbg_ptr, fill);
    }
    /**
     * @param {number} index
     * @param {boolean} enabled
     */
    set_layer_mask_enabled(index, enabled) {
        const ret = wasm.npaint_set_layer_mask_enabled(this.__wbg_ptr, index, enabled);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     * @param {number} opacity
     */
    set_layer_opacity(index, opacity) {
        const ret = wasm.npaint_set_layer_opacity(this.__wbg_ptr, index, opacity);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Points the tools at the layer's mask (`true`) or its pixels.
     * @param {number} index
     * @param {boolean} mask
     */
    set_layer_target(index, mask) {
        const ret = wasm.npaint_set_layer_target(this.__wbg_ptr, index, mask);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     * @param {boolean} visible
     */
    set_layer_visible(index, visible) {
        const ret = wasm.npaint_set_layer_visible(this.__wbg_ptr, index, visible);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} opacity
     */
    set_opacity(opacity) {
        wasm.npaint_set_opacity(this.__wbg_ptr, opacity);
    }
    /**
     * @param {boolean} all
     */
    set_sample_all_layers(all) {
        wasm.npaint_set_sample_all_layers(this.__wbg_ptr, all);
    }
    /**
     * "contiguous" or "global": whether the wand may reach across the image.
     * @param {string} name
     */
    set_sample_mode(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_sample_mode(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} scrubby
     */
    set_scrubby_zoom(scrubby) {
        wasm.npaint_set_scrubby_zoom(this.__wbg_ptr, scrubby);
    }
    /**
     * @param {number} size
     */
    set_size(size) {
        wasm.npaint_set_size(this.__wbg_ptr, size);
    }
    /**
     * @param {number} tolerance
     */
    set_tolerance(tolerance) {
        wasm.npaint_set_tolerance(this.__wbg_ptr, tolerance);
    }
    /**
     * @param {string} name
     */
    set_tool(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_tool(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} view_w
     * @param {number} view_h
     */
    set_view_size(view_w, view_h) {
        wasm.npaint_set_view_size(this.__wbg_ptr, view_w, view_h);
    }
    /**
     * @param {number} zoom
     * @param {number} x
     * @param {number} y
     */
    set_zoom_about(zoom, x, y) {
        wasm.npaint_set_zoom_about(this.__wbg_ptr, zoom, x, y);
    }
    /**
     * @returns {number}
     */
    size() {
        const ret = wasm.npaint_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    swap_colors() {
        wasm.npaint_swap_colors(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    tolerance() {
        const ret = wasm.npaint_tolerance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    tool() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_tool(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string[]}
     */
    static tool_names() {
        const ret = wasm.npaint_tool_names();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * `[x, y, w, h]` in screen pixels for the rubber band the current
     * gesture wants drawn, or empty when there is none.
     * @returns {Float64Array}
     */
    tool_overlay() {
        const ret = wasm.npaint_tool_overlay(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    transform_flip_horizontal() {
        const ret = wasm.npaint_transform_flip_horizontal(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    transform_flip_vertical() {
        const ret = wasm.npaint_transform_flip_vertical(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The eight handles as `[x0, y0, x1, y1, ...]` in screen pixels, in the
     * order top-left, top, top-right, right, bottom-right, bottom,
     * bottom-left, left. Empty when not transforming.
     * @returns {Float64Array}
     */
    transform_handles() {
        const ret = wasm.npaint_transform_handles(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * What the pointer would grab at a screen position: a handle name
     * (`"top-left"`, `"top"`, ...), `"inside"`, `"rotate"` or `"outside"`.
     * Empty when not transforming.
     * @param {number} x
     * @param {number} y
     * @returns {string}
     */
    transform_hit(x, y) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_transform_hit(this.__wbg_ptr, x, y);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `[x, y, width, height, scale_x, scale_y, angle_degrees]`, or empty.
     * @returns {Float64Array}
     */
    transform_info() {
        const ret = wasm.npaint_transform_info(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} dx
     * @param {number} dy
     * @returns {boolean}
     */
    transform_nudge(dx, dy) {
        const ret = wasm.npaint_transform_nudge(this.__wbg_ptr, dx, dy);
        return ret !== 0;
    }
    /**
     * @param {number} degrees
     * @returns {boolean}
     */
    transform_rotate(degrees) {
        const ret = wasm.npaint_transform_rotate(this.__wbg_ptr, degrees);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    undo() {
        const ret = wasm.npaint_undo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    width() {
        const ret = wasm.npaint_width(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    zoom() {
        const ret = wasm.npaint_zoom(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} factor
     * @param {number} x
     * @param {number} y
     */
    zoom_by_about(factor, x, y) {
        wasm.npaint_zoom_by_about(this.__wbg_ptr, factor, x, y);
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    zoom_in_about(x, y) {
        wasm.npaint_zoom_in_about(this.__wbg_ptr, x, y);
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    zoom_out_about(x, y) {
        wasm.npaint_zoom_out_about(this.__wbg_ptr, x, y);
    }
    /**
     * @param {number} view_w
     * @param {number} view_h
     */
    zoom_to_actual_size(view_w, view_h) {
        wasm.npaint_zoom_to_actual_size(this.__wbg_ptr, view_w, view_h);
    }
}
if (Symbol.dispose) NPaint.prototype[Symbol.dispose] = NPaint.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_5d9e815e6fdf150f: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./npaint_bg.js": import0,
    };
}

const NPaintFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_npaint_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('npaint_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
