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
     * Adds a picture of any size as a layer at its own resolution, centred
     * — Open as Layer.
     * @param {string} name
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    add_layer_centred(name, width, height, bytes) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_add_layer_centred(this.__wbg_ptr, ptr0, len0, width, height, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
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
     * Auto Levels (`per_channel`) or Auto Contrast on the selected pixels.
     * @param {boolean} per_channel
     * @returns {boolean}
     */
    auto_levels(per_channel) {
        const ret = wasm.npaint_auto_levels(this.__wbg_ptr, per_channel);
        return ret !== 0;
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
    /**
     * Starts editing the text of layer `index`.
     * @param {number} index
     */
    begin_text_edit(index) {
        const ret = wasm.npaint_begin_text_edit(this.__wbg_ptr, index);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Starts a new text layer with its text's corner at a screen point.
     * Returns the layer's index.
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    begin_text_layer(x, y) {
        const ret = wasm.npaint_begin_text_layer(this.__wbg_ptr, x, y);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    begin_transform() {
        const ret = wasm.npaint_begin_transform(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Starts a free transform of the selection outline rather than pixels.
     */
    begin_transform_selection() {
        const ret = wasm.npaint_begin_transform_selection(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {string[]}
     */
    static blend_mode_labels() {
        const ret = wasm.npaint_blend_mode_labels();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    static blend_mode_names() {
        const ret = wasm.npaint_blend_mode_names();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    brush_tip() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_brush_tip(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Whether the hardness slider means anything to the current tip.
     * @returns {boolean}
     */
    brush_tip_has_hardness() {
        const ret = wasm.npaint_brush_tip_has_hardness(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string[]}
     */
    static brush_tip_labels() {
        const ret = wasm.npaint_brush_tip_labels();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    static brush_tip_names() {
        const ret = wasm.npaint_brush_tip_names();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
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
    clear_subject_box() {
        wasm.npaint_clear_subject_box(this.__wbg_ptr);
    }
    /**
     * The clipboard's pixels as straight-alpha RGBA, for the page to hand
     * to the system clipboard.
     * @returns {Uint8Array}
     */
    clipboard_rgba() {
        const ret = wasm.npaint_clipboard_rgba(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * `[width, height]` of what the clipboard holds, or empty.
     * @returns {Uint32Array}
     */
    clipboard_size() {
        const ret = wasm.npaint_clipboard_size(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
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
     * `[width, height]` the canvas would need to hold everything, which is
     * the canvas it has when nothing hangs outside it.
     * @returns {Uint32Array}
     */
    content_size() {
        const ret = wasm.npaint_content_size(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
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
    /**
     * Copies the selected pixels of the active surface, or of the whole
     * picture when `merged`. False when there is nothing to copy.
     * @param {boolean} merged
     * @returns {boolean}
     */
    copy_selection(merged) {
        const ret = wasm.npaint_copy_selection(this.__wbg_ptr, merged);
        return ret !== 0;
    }
    /**
     * Crops the canvas to the selection's bounding box.
     * @returns {boolean}
     */
    crop_to_selection() {
        const ret = wasm.npaint_crop_to_selection(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    cut_selection() {
        const ret = wasm.npaint_cut_selection(this.__wbg_ptr);
        return ret !== 0;
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
     * Replaces the guides as an undo step labelled `label` — the page's
     * "Add Guide", "Move Guide", "Remove Guide" or "Clear Guides".
     * @param {Float64Array} h
     * @param {Float64Array} v
     * @param {string} label
     * @returns {boolean}
     */
    edit_guides(h, v, label) {
        const ptr0 = passArrayF64ToWasm0(h, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(v, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_edit_guides(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        return ret !== 0;
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
     * The flattened picture inside a rectangle, as RGBA bytes, for the
     * subject model.
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @returns {Uint8Array}
     */
    frame_crop(x, y, w, h) {
        const ret = wasm.npaint_frame_crop(this.__wbg_ptr, x, y, w, h);
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
    gradient_reverse() {
        const ret = wasm.npaint_gradient_reverse(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    gradient_shape() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_gradient_shape(this.__wbg_ptr);
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
    static gradient_shape_labels() {
        const ret = wasm.npaint_gradient_shape_labels();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    static gradient_shape_names() {
        const ret = wasm.npaint_gradient_shape_names();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * The guides as the engine has them: what an opened file brought in.
     * @returns {Float64Array}
     */
    guides_h() {
        const ret = wasm.npaint_guides_h(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    guides_v() {
        const ret = wasm.npaint_guides_v(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    hardness() {
        const ret = wasm.npaint_hardness(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    has_clipboard() {
        const ret = wasm.npaint_has_clipboard(this.__wbg_ptr);
        return ret !== 0;
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
     * Jumps to having `steps` of the history applied.
     * @param {number} steps
     * @returns {boolean}
     */
    history_go_to(steps) {
        const ret = wasm.npaint_history_go_to(this.__wbg_ptr, steps);
        return ret !== 0;
    }
    /**
     * Every step in the history, oldest first, done and undone alike.
     * @returns {string[]}
     */
    history_labels() {
        const ret = wasm.npaint_history_labels(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    history_limit() {
        const ret = wasm.npaint_history_limit(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * How many of those steps are applied.
     * @returns {number}
     */
    history_position() {
        const ret = wasm.npaint_history_position(this.__wbg_ptr);
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
    is_editing_text() {
        const ret = wasm.npaint_is_editing_text(this.__wbg_ptr);
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
     * Whether the document differs from what was last saved or opened.
     * @returns {boolean}
     */
    is_modified() {
        const ret = wasm.npaint_is_modified(this.__wbg_ptr);
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
     * @returns {boolean}
     */
    is_transforming_selection() {
        const ret = wasm.npaint_is_transforming_selection(this.__wbg_ptr);
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
     * The blend mode's name, as `blend_mode_names` lists them.
     * @param {number} index
     * @returns {string}
     */
    layer_blend(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.npaint_layer_blend(this.__wbg_ptr, index);
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
    layer_lock_alpha(index) {
        const ret = wasm.npaint_layer_lock_alpha(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {number} index
     * @returns {boolean}
     */
    layer_locked(index) {
        const ret = wasm.npaint_layer_locked(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
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
     * A smart object's or text layer's placement, source pixels →
     * document pixels, as the six numbers of a CSS `matrix()`; empty for
     * any other layer.
     * @param {number} index
     * @returns {Float64Array}
     */
    layer_placement(index) {
        const ret = wasm.npaint_layer_placement(this.__wbg_ptr, index);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * A text layer's text, or an empty string for any other layer.
     * @param {number} index
     * @returns {string}
     */
    layer_text(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.npaint_layer_text(this.__wbg_ptr, index);
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
     * Where the block of text starts within a text layer's source, as
     * `[x, y]`; empty for any other layer.
     * @param {number} index
     * @returns {Float64Array}
     */
    layer_text_origin(index) {
        const ret = wasm.npaint_layer_text_origin(this.__wbg_ptr, index);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
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
     * Marks the document as never saved — for a document restored from
     * the page's crash-recovery store, which is unsaved work however new
     * its history is.
     */
    mark_unsaved() {
        wasm.npaint_mark_unsaved(this.__wbg_ptr);
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
     * Moves the selected pixels (or the whole layer) by whole pixels; a run
     * of nudges is one undo step.
     * @param {number} dx
     * @param {number} dy
     * @returns {boolean}
     */
    nudge_layer(dx, dy) {
        const ret = wasm.npaint_nudge_layer(this.__wbg_ptr, dx, dy);
        return ret !== 0;
    }
    /**
     * Moves the selection outline by whole pixels.
     * @param {number} dx
     * @param {number} dy
     * @returns {boolean}
     */
    nudge_selection(dx, dy) {
        const ret = wasm.npaint_nudge_selection(this.__wbg_ptr, dx, dy);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    opacity() {
        const ret = wasm.npaint_opacity(this.__wbg_ptr);
        return ret;
    }
    /**
     * Replaces the document with an NPaint file's.
     * @param {Uint8Array} bytes
     */
    open_document(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_open_document(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
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
     * Pastes the clipboard as a new layer. The layer's index, or none when
     * the clipboard is empty.
     * @returns {number | undefined}
     */
    paste() {
        const ret = wasm.npaint_paste(this.__wbg_ptr);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * Pastes a picture from outside — the system clipboard, a dropped file
     * — as a new layer, centred.
     * @param {string} name
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    paste_external(name, width, height, bytes) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_paste_external(this.__wbg_ptr, ptr0, len0, width, height, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
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
     * `pressure` is the pen's, `0.0..=1.0`; pass 1 for a mouse.
     * @param {number} x
     * @param {number} y
     * @param {boolean} shift
     * @param {boolean} alt
     * @param {number} pressure
     * @returns {boolean}
     */
    pointer_down(x, y, shift, alt, pressure) {
        const ret = wasm.npaint_pointer_down(this.__wbg_ptr, x, y, shift, alt, pressure);
        return ret !== 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {boolean} shift
     * @param {boolean} alt
     * @param {number} pressure
     * @returns {boolean}
     */
    pointer_move(x, y, shift, alt, pressure) {
        const ret = wasm.npaint_pointer_move(this.__wbg_ptr, x, y, shift, alt, pressure);
        return ret !== 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {boolean} shift
     * @param {boolean} alt
     * @param {number} pressure
     * @returns {boolean}
     */
    pointer_up(x, y, shift, alt, pressure) {
        const ret = wasm.npaint_pointer_up(this.__wbg_ptr, x, y, shift, alt, pressure);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    pressure_size() {
        const ret = wasm.npaint_pressure_size(this.__wbg_ptr);
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
     * @returns {number}
     */
    preview_len() {
        const ret = wasm.npaint_preview_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    preview_ptr() {
        const ret = wasm.npaint_preview_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Sets the text being edited: the text itself, and its rendering as
     * straight-alpha RGBA bytes of `width` by `height`, with the block of
     * text starting at (`ox`, `oy`) inside it.
     * @param {string} text
     * @param {number} ox
     * @param {number} oy
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} bytes
     * @returns {boolean}
     */
    preview_text(text, ox, oy, width, height, bytes) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_preview_text(this.__wbg_ptr, ptr0, len0, ox, oy, width, height, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
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
     * Makes a checkerboard baked into the active layer transparent. False
     * when its edges show no board.
     * @returns {boolean}
     */
    remove_checkerboard() {
        const ret = wasm.npaint_remove_checkerboard(this.__wbg_ptr);
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
     * Recomposites whatever has changed since the last call and says what
     * that was, as `[x, y, w, h]` in document pixels — empty when nothing
     * has, so the page can skip the upload entirely.
     *
     * Only the rectangle is redrawn, in the frame and in the bytes behind
     * it; the rest of both is left as the last call made it. The page must
     * therefore upload the same rectangle, and must not assume the frame it
     * holds was built in one go.
     * @returns {Int32Array}
     */
    render() {
        const ret = wasm.npaint_render(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Composites the reduced preview a dialog is running, and says what
     * size it came out as: `[width, height, step]`, or empty when there is
     * no reduced preview — no session, or the canvas is zoomed in far
     * enough that there is nothing to save.
     *
     * The page draws this stretched over the canvas in place of the frame,
     * and goes back to [`NPaint::render`] when the session ends. The frame
     * itself is left alone while a preview runs, so the page must not mix
     * the two.
     * @returns {Int32Array}
     */
    render_preview() {
        const ret = wasm.npaint_render_preview(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
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
     * Scales the whole picture to a new size.
     * @param {number} width
     * @param {number} height
     * @returns {boolean}
     */
    resize_image(width, height) {
        const ret = wasm.npaint_resize_image(this.__wbg_ptr, width, height);
        return ret !== 0;
    }
    /**
     * Grows the canvas to hold everything the layers have, including the
     * parts of a smart object hanging outside it — Image > Reveal All.
     * False when there is nothing outside to reveal.
     * @returns {boolean}
     */
    reveal_all() {
        const ret = wasm.npaint_reveal_all(this.__wbg_ptr);
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
     * The document as an NPaint file, and from now on it counts as saved.
     * @returns {Uint8Array}
     */
    save_document() {
        const ret = wasm.npaint_save_document(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
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
     * The built-in finder over the box, for when the model is not there.
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @param {boolean} shift
     * @param {boolean} alt
     * @returns {boolean}
     */
    select_subject_builtin_in_box(x, y, w, h, shift, alt) {
        const ret = wasm.npaint_select_subject_builtin_in_box(this.__wbg_ptr, x, y, w, h, shift, alt);
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
     * Selects the subject the model found in the box: `matte` is the
     * model's coverage of the box alone. Shift adds to the selection and
     * Alt takes away, as with the other selection tools.
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @param {Uint8Array} matte
     * @param {number} matte_w
     * @param {number} matte_h
     * @param {boolean} shift
     * @param {boolean} alt
     * @returns {boolean}
     */
    select_subject_in_box(x, y, w, h, matte, matte_w, matte_h, shift, alt) {
        const ptr0 = passArray8ToWasm0(matte, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_select_subject_in_box(this.__wbg_ptr, x, y, w, h, ptr0, len0, matte_w, matte_h, shift, alt);
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
     * The shape of the brush's dab, by name: see [`BrushTip::name`].
     * @param {string} name
     */
    set_brush_tip(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_brush_tip(this.__wbg_ptr, ptr0, len0);
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
     * @param {boolean} on
     */
    set_gradient_reverse(on) {
        wasm.npaint_set_gradient_reverse(this.__wbg_ptr, on);
    }
    /**
     * How the gradient tool lays its colours out, by name: see
     * [`GradientShape::name`].
     * @param {string} name
     */
    set_gradient_shape(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_gradient_shape(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The guides the page draws, in document pixels, for the move tool and
     * transforms to snap to. Call whenever they change.
     * @param {Float64Array} h
     * @param {Float64Array} v
     */
    set_guides(h, v) {
        const ptr0 = passArrayF64ToWasm0(h, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(v, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.npaint_set_guides(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    /**
     * How far out a brush dab is solid before it fades, `0.0..=1.0`.
     * @param {number} hardness
     */
    set_hardness(hardness) {
        wasm.npaint_set_hardness(this.__wbg_ptr, hardness);
    }
    /**
     * @param {number} limit
     */
    set_history_limit(limit) {
        wasm.npaint_set_history_limit(this.__wbg_ptr, limit);
    }
    /**
     * @param {number} index
     * @param {string} name
     */
    set_layer_blend(index, name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_layer_blend(this.__wbg_ptr, index, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     * @param {boolean} locked
     */
    set_layer_lock_alpha(index, locked) {
        const ret = wasm.npaint_set_layer_lock_alpha(this.__wbg_ptr, index, locked);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} index
     * @param {boolean} locked
     */
    set_layer_locked(index, locked) {
        const ret = wasm.npaint_set_layer_locked(this.__wbg_ptr, index, locked);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
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
     * @param {boolean} on
     */
    set_pressure_size(on) {
        wasm.npaint_set_pressure_size(this.__wbg_ptr, on);
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
     * @param {number} smoothing
     */
    set_smoothing(smoothing) {
        wasm.npaint_set_smoothing(this.__wbg_ptr, smoothing);
    }
    /**
     * @param {boolean} on
     */
    set_snap(on) {
        wasm.npaint_set_snap(this.__wbg_ptr, on);
    }
    /**
     * Paint symmetry: mirrors in the canvas's vertical and horizontal
     * axes, and how many ways the stroke is turned about the centre (1
     * for none).
     * @param {boolean} mirror_x
     * @param {boolean} mirror_y
     * @param {number} radial
     */
    set_symmetry(mirror_x, mirror_y, radial) {
        wasm.npaint_set_symmetry(this.__wbg_ptr, mirror_x, mirror_y, radial);
    }
    /**
     * "left", "center" or "right".
     * @param {string} name
     */
    set_text_align(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_text_align(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} bold
     */
    set_text_bold(bold) {
        wasm.npaint_set_text_bold(this.__wbg_ptr, bold);
    }
    /**
     * @param {string} font
     */
    set_text_font(font) {
        const ptr0 = passStringToWasm0(font, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.npaint_set_text_font(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {boolean} italic
     */
    set_text_italic(italic) {
        wasm.npaint_set_text_italic(this.__wbg_ptr, italic);
    }
    /**
     * @param {string} hex
     */
    set_text_outline_color(hex) {
        const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_text_outline_color(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The Character panel's settings by name — see `text::PARAMS`; a flag
     * is 0 or 1. Setting one clamps it to its range.
     * @param {string} name
     * @param {number} value
     */
    set_text_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_set_text_param(this.__wbg_ptr, ptr0, len0, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} size
     */
    set_text_size(size) {
        wasm.npaint_set_text_size(this.__wbg_ptr, size);
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
    /**
     * @returns {number}
     */
    smoothing() {
        const ret = wasm.npaint_smoothing(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    snap() {
        const ret = wasm.npaint_snap(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The document as an NPaint file, leaving it counting as unsaved:
     * what the page's autosave keeps for crash recovery.
     * @returns {Uint8Array}
     */
    snapshot_document() {
        const ret = wasm.npaint_snapshot_document(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Paints a line `width` wide along the selection's edge in the
     * foreground colour.
     * @param {number} width
     * @returns {boolean}
     */
    stroke_selection(width) {
        const ret = wasm.npaint_stroke_selection(this.__wbg_ptr, width);
        return ret !== 0;
    }
    /**
     * The subject tool's box as `[x, y, w, h]`, or empty when there is none.
     * @returns {Int32Array}
     */
    subject_box() {
        const ret = wasm.npaint_subject_box(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    swap_colors() {
        wasm.npaint_swap_colors(this.__wbg_ptr);
    }
    /**
     * The symmetry as `[mirror_x, mirror_y, radial]`.
     * @returns {Uint32Array}
     */
    symmetry() {
        const ret = wasm.npaint_symmetry(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    text_align() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_text_align(this.__wbg_ptr);
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
    text_bold() {
        const ret = wasm.npaint_text_bold(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    text_font() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_text_font(this.__wbg_ptr);
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
    text_italic() {
        const ret = wasm.npaint_text_italic(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The text layer under a screen point, or -1.
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    text_layer_at(x, y) {
        const ret = wasm.npaint_text_layer_at(this.__wbg_ptr, x, y);
        return ret;
    }
    /**
     * @returns {string}
     */
    text_outline_color() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.npaint_text_outline_color(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} name
     * @returns {number}
     */
    text_param(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.npaint_text_param(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * The names of the Character panel's settings, with `[min, max]` for
     * each in `text_param_ranges`.
     * @returns {string[]}
     */
    static text_param_names() {
        const ret = wasm.npaint_text_param_names();
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    static text_param_ranges() {
        const ret = wasm.npaint_text_param_ranges();
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    text_size() {
        const ret = wasm.npaint_text_size(this.__wbg_ptr);
        return ret;
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
     * @param {number} degrees
     * @returns {boolean}
     */
    transform_set_angle(degrees) {
        const ret = wasm.npaint_transform_set_angle(this.__wbg_ptr, degrees);
        return ret !== 0;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    transform_set_position(x, y) {
        const ret = wasm.npaint_transform_set_position(this.__wbg_ptr, x, y);
        return ret !== 0;
    }
    /**
     * @param {number} width
     * @param {number} height
     * @returns {boolean}
     */
    transform_set_size(width, height) {
        const ret = wasm.npaint_transform_set_size(this.__wbg_ptr, width, height);
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

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
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

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
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
    cachedUint32ArrayMemory0 = null;
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
