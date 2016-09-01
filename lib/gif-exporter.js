var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator.throw(value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments)).next());
    });
};
/*
    SuperGif

    Example usage:

        <img src="./example1_preview.gif" rel:animated_src="./example1.gif" width="360" height="360" rel:auto_play="1" />

        <script type="text/javascript">
            $$('img').each(function (img_tag) {
                if (/.*\.gif/.test(img_tag.src)) {
                    var rub = new SuperGif({ gif: img_tag } );
                    rub.load();
                }
            });
        </script>

    Image tag attributes:

        rel:animated_src -	If this url is specified, it's loaded into the player instead of src.
                            This allows a preview frame to be shown until animated gif data is streamed into the canvas

        rel:auto_play -		Defaults to 1 if not specified. If set to zero, a call to the play() method is needed

    Constructor options args

        gif 				Required. The DOM element of an img tag.
        loop_mode			Optional. Setting this to false will force disable looping of the gif.
        auto_play 			Optional. Same as the rel:auto_play attribute above, this arg overrides the img tag info.
        max_width			Optional. Scale images over max_width down to max_width. Helpful with mobile.
        on_end				Optional. Add a callback for when the gif reaches the end of a single loop (one iteration). The first argument passed will be the gif HTMLElement.
        loop_delay			Optional. The amount of time to pause (in ms) after each single loop (iteration).
        draw_while_loading	Optional. Determines whether the gif will be drawn to the canvas whilst it is loaded.
        show_progress_bar	Optional. Only applies when draw_while_loading is set to true.

    Instance methods

        // loading
        load( callback )		Loads the gif specified by the src or rel:animated_src sttributie of the img tag into a canvas element and then calls callback if one is passed
        load_url( src, callback )	Loads the gif file specified in the src argument into a canvas element and then calls callback if one is passed

        // play controls
        play -				Start playing the gif
        pause -				Stop playing the gif
        move_to(i) -		Move to frame i of the gif
        move_relative(i) -	Move i frames ahead (or behind if i < 0)

        // getters
        get_canvas			The canvas element that the gif is playing in. Handy for assigning event handlers to.
        get_playing			Whether or not the gif is currently playing
        get_loading			Whether or not the gif has finished loading/parsing
        get_auto_play		Whether or not the gif is set to play automatically
        get_length			The number of frames in the gif
        get_current_frame	The index of the currently displayed frame of the gif

        For additional customization (viewport inside iframe) these params may be passed:
        c_w, c_h - width and height of canvas
        vp_t, vp_l, vp_ w, vp_h - top, left, width and height of the viewport

        A bonus: few articles to understand what is going on
            http://enthusiasms.org/post/16976438906
            http://www.matthewflickinger.com/lab/whatsinagif/bits_and_bytes.asp
            http://humpy77.deviantart.com/journal/Frame-Delay-Times-for-Animated-GIFs-214150546

*/
var GIFExporter;
(function (GIFExporter) {
    // Generic functions
    function bitsToNum(ba) {
        return ba.reduce((s, n) => s * 2 + Number(n), 0);
    }
    ;
    function byteToBitArr(bite) {
        const a = [];
        for (let i = 7; i >= 0; i--) {
            a.push(!!(bite & (1 << i)));
        }
        return a;
    }
    ;
    // Stream
    class Stream {
        constructor(data) {
            this.data = data;
            this.position = 0;
        }
        readByte() {
            if (this.position >= this.data.length) {
                throw new Error('Attempted to read past end of stream.');
            }
            return this.data[this.position++];
        }
        ;
        readBytes(n) {
            const bytes = [];
            for (let i = 0; i < n; i++) {
                bytes.push(this.readByte());
            }
            return bytes;
        }
        ;
        read(n) {
            let s = '';
            for (let i = 0; i < n; i++) {
                s += String.fromCharCode(this.readByte());
            }
            return s;
        }
        ;
        readUnsigned() {
            const a = this.readBytes(2);
            return (a[1] << 8) + a[0];
        }
        ;
    }
    ;
    function lzwDecode(minCodeSize, data) {
        // TODO: Now that the GIF parser is a bit different, maybe this should get an array of bytes instead of a String?
        let pos = 0; // Maybe this streaming thing should be merged with the Stream?
        const readCode = (size) => {
            let code = 0;
            for (let i = 0; i < size; i++) {
                if (data.charCodeAt(pos >> 3) & (1 << (pos & 7))) {
                    code |= 1 << i;
                }
                pos++;
            }
            return code;
        };
        const output = [];
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        let codeSize = minCodeSize + 1;
        const dict = [];
        const clear = () => {
            dict.length = 0;
            codeSize = minCodeSize + 1;
            for (let i = 0; i < clearCode; i++) {
                dict[i] = [i];
            }
            dict[clearCode] = [];
            dict[eoiCode] = null;
        };
        let code;
        let last;
        while (true) {
            last = code;
            code = readCode(codeSize);
            if (code === clearCode) {
                clear();
                continue;
            }
            if (code === eoiCode)
                break;
            if (code < dict.length) {
                if (last !== clearCode) {
                    dict.push(dict[last].concat(dict[code][0]));
                }
            }
            else {
                if (code !== dict.length)
                    throw new Error('Invalid LZW code.');
                dict.push(dict[last].concat(dict[last][0]));
            }
            output.push.apply(output, dict[code]);
            if (dict.length === (1 << codeSize) && codeSize < 12) {
                // If we're at the last code and codeSize is 12, the next code will be a clearCode, and it'll be 12 bits long.
                codeSize++;
            }
        }
        // I don't know if this is technically an error, but some GIFs do it.
        //if (Math.ceil(pos / 8) !== data.length) throw new Error('Extraneous LZW bytes.');
        return output;
    }
    ;
    // The actual parsing; returns an object with properties.
    function parseGIF(st, handler) {
        handler || (handler = {});
        // LZW (GIF-specific)
        const parseCT = (entries) => {
            const ct = [];
            for (let i = 0; i < entries; i++) {
                ct.push(st.readBytes(3));
            }
            return ct;
        };
        const readSubBlocks = () => {
            let size;
            let data = '';
            do {
                size = st.readByte();
                data += st.read(size);
            } while (size !== 0);
            return data;
        };
        const parseHeader = () => {
            const hdr = {};
            hdr.sig = st.read(3);
            hdr.ver = st.read(3);
            if (hdr.sig !== 'GIF')
                throw new Error('Not a GIF file.'); // XXX: This should probably be handled more nicely.
            hdr.width = st.readUnsigned();
            hdr.height = st.readUnsigned();
            const bits = byteToBitArr(st.readByte());
            hdr.gctFlag = bits.shift();
            hdr.colorRes = bitsToNum(bits.splice(0, 3));
            hdr.sorted = bits.shift();
            hdr.gctSize = bitsToNum(bits.splice(0, 3));
            hdr.bgColor = st.readByte();
            hdr.pixelAspectRatio = st.readByte(); // if not 0, aspectRatio = (pixelAspectRatio + 15) / 64
            if (hdr.gctFlag) {
                hdr.gct = parseCT(1 << (hdr.gctSize + 1));
            }
            handler.hdr && handler.hdr(hdr);
        };
        const parseExt = (block) => {
            const parseGCExt = (block) => {
                const blockSize = st.readByte(); // Always 4
                const bits = byteToBitArr(st.readByte());
                block.reserved = bits.splice(0, 3); // Reserved; should be 000.
                block.disposalMethod = bitsToNum(bits.splice(0, 3));
                block.userInput = bits.shift();
                block.transparencyGiven = bits.shift();
                block.delayTime = st.readUnsigned();
                block.transparencyIndex = st.readByte();
                block.terminator = st.readByte();
                handler.gce && handler.gce(block);
            };
            const parseComExt = (block) => {
                block.comment = readSubBlocks();
                handler.com && handler.com(block);
            };
            const parsePTExt = (block) => {
                // No one *ever* uses this. If you use it, deal with parsing it yourself.
                const blockSize = st.readByte(); // Always 12
                block.ptHeader = st.readBytes(12);
                block.ptData = readSubBlocks();
                handler.pte && handler.pte(block);
            };
            const parseAppExt = (block) => {
                const parseNetscapeExt = (block) => {
                    const blockSize = st.readByte(); // Always 3
                    block.unknown = st.readByte(); // ??? Always 1? What is this?
                    block.iterations = st.readUnsigned();
                    block.terminator = st.readByte();
                    handler.app && handler.app.NETSCAPE && handler.app.NETSCAPE(block);
                };
                const parseUnknownAppExt = (block) => {
                    block.appData = readSubBlocks();
                    // FIXME: This won't work if a handler wants to match on any identifier.
                    handler.app && handler.app[block.identifier] && handler.app[block.identifier](block);
                };
                const blockSize = st.readByte(); // Always 11
                block.identifier = st.read(8);
                block.authCode = st.read(3);
                switch (block.identifier) {
                    case 'NETSCAPE':
                        parseNetscapeExt(block);
                        break;
                    default:
                        parseUnknownAppExt(block);
                        break;
                }
            };
            const parseUnknownExt = (block) => {
                block.data = readSubBlocks();
                handler.unknown && handler.unknown(block);
            };
            block.label = st.readByte();
            switch (block.label) {
                case 0xF9:
                    block.extType = 'gce';
                    parseGCExt(block);
                    break;
                case 0xFE:
                    block.extType = 'com';
                    parseComExt(block);
                    break;
                case 0x01:
                    block.extType = 'pte';
                    parsePTExt(block);
                    break;
                case 0xFF:
                    block.extType = 'app';
                    parseAppExt(block);
                    break;
                default:
                    block.extType = 'unknown';
                    parseUnknownExt(block);
                    break;
            }
        };
        const parseImg = (img) => {
            const deinterlace = (pixels, width) => {
                // Of course this defeats the purpose of interlacing. And it's *probably*
                // the least efficient way it's ever been implemented. But nevertheless...
                const newPixels = new Array(pixels.length);
                const rows = pixels.length / width;
                const cpRow = (toRow, fromRow) => {
                    const fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
                    newPixels.splice.apply(newPixels, [toRow * width, width].concat(fromPixels));
                };
                // See appendix E.
                const offsets = [0, 4, 2, 1];
                const steps = [8, 8, 4, 2];
                let fromRow = 0;
                for (let pass = 0; pass < 4; pass++) {
                    for (let toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
                        cpRow(toRow, fromRow);
                        fromRow++;
                    }
                }
                return newPixels;
            };
            img.leftPos = st.readUnsigned();
            img.topPos = st.readUnsigned();
            img.width = st.readUnsigned();
            img.height = st.readUnsigned();
            const bits = byteToBitArr(st.readByte());
            img.lctFlag = bits.shift();
            img.interlaced = bits.shift();
            img.sorted = bits.shift();
            img.reserved = bits.splice(0, 2);
            img.lctSize = bitsToNum(bits.splice(0, 3));
            if (img.lctFlag) {
                img.lct = parseCT(1 << (img.lctSize + 1));
            }
            img.lzwMinCodeSize = st.readByte();
            const lzwData = readSubBlocks();
            img.pixels = lzwDecode(img.lzwMinCodeSize, lzwData);
            if (img.interlaced) {
                img.pixels = deinterlace(img.pixels, img.width);
            }
            handler.img && handler.img(img);
        };
        const parseBlock = () => {
            const block = {};
            block.sentinel = st.readByte();
            switch (String.fromCharCode(block.sentinel)) {
                case '!':
                    block.type = 'ext';
                    parseExt(block);
                    break;
                case ',':
                    block.type = 'img';
                    parseImg(block);
                    break;
                case ';':
                    block.type = 'eof';
                    handler.eof && handler.eof(block);
                    break;
                default:
                    throw new Error('Unknown block: 0x' + block.sentinel.toString(16)); // TODO: Pad this with a 0.
            }
            if (block.type !== 'eof')
                setTimeout(parseBlock, 0);
        };
        const parse = () => {
            parseHeader();
            setTimeout(parseBlock, 0);
        };
        parse();
    }
    ;
    function toArrayBuffer(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = err => reject(err);
            reader.onload = () => resolve(reader.result);
            reader.readAsArrayBuffer(blob);
        });
    }
    function get(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const buffer = input instanceof Blob ? yield toArrayBuffer(input) : input;
            const tmpCanvas = document.createElement('canvas');
            let frame;
            let hdr;
            let transparency;
            let delay;
            let disposalMethod;
            let disposalRestoreFromIdx;
            let lastDisposalMethod;
            let lastImg;
            const frames = [];
            const clear = () => {
                transparency = null;
                delay = null;
                lastDisposalMethod = disposalMethod;
                disposalMethod = null;
                frame = null;
            };
            const setSizes = (w, h) => {
                tmpCanvas.width = w;
                tmpCanvas.height = h;
            };
            const doHdr = (_hdr) => {
                hdr = _hdr;
                setSizes(hdr.width, hdr.height);
            };
            const doGCE = (gce) => {
                pushFrame();
                clear();
                transparency = gce.transparencyGiven ? gce.transparencyIndex : null;
                delay = gce.delayTime;
                disposalMethod = gce.disposalMethod;
                // We don't have much to do with the rest of GCE.
            };
            const pushFrame = () => {
                if (!frame)
                    return;
                frames.push({
                    data: frame.getImageData(0, 0, hdr.width, hdr.height),
                    delay
                });
            };
            const doImg = (img) => {
                if (!frame)
                    frame = tmpCanvas.getContext('2d');
                const currIdx = frames.length;
                //ct = color table, gct = global color table
                const ct = img.lctFlag ? img.lct : hdr.gct; // TODO: What if neither exists?
                /*
                Disposal method indicates the way in which the graphic is to
                be treated after being displayed.
    
                Values :    0 - No disposal specified. The decoder is
                                not required to take any action.
                            1 - Do not dispose. The graphic is to be left
                                in place.
                            2 - Restore to background color. The area used by the
                                graphic must be restored to the background color.
                            3 - Restore to previous. The decoder is required to
                                restore the area overwritten by the graphic with
                                what was there prior to rendering the graphic.
    
                                Importantly, "previous" means the frame state
                                after the last disposal of method 0, 1, or 2.
                */
                if (currIdx > 0) {
                    if (lastDisposalMethod === 3) {
                        // Restore to previous
                        // If we disposed every frame including first frame up to this point, then we have
                        // no composited frame to restore to. In this case, restore to background instead.
                        if (disposalRestoreFromIdx != null) {
                            frame.putImageData(frames[disposalRestoreFromIdx].data, 0, 0);
                        }
                        else {
                            frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
                        }
                    }
                    else {
                        disposalRestoreFromIdx = currIdx - 1;
                    }
                    if (lastDisposalMethod === 2) {
                        // Restore to background color
                        // Browser implementations historically restore to transparent; we do the same.
                        // http://www.wizards-toolkit.org/discourse-server/viewtopic.php?f=1&t=21172#p86079
                        frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
                    }
                }
                // else, Undefined/Do not dispose.
                // frame contains final pixel data from the last frame; do nothing
                //Get existing pixels for img region after applying disposal method
                const imgData = frame.getImageData(img.leftPos, img.topPos, img.width, img.height);
                //apply color table colors
                img.pixels.forEach((pixel, i) => {
                    // imgData.data === [R,G,B,A,R,G,B,A,...]
                    if (pixel !== transparency) {
                        imgData.data[i * 4 + 0] = ct[pixel][0];
                        imgData.data[i * 4 + 1] = ct[pixel][1];
                        imgData.data[i * 4 + 2] = ct[pixel][2];
                        imgData.data[i * 4 + 3] = 255; // Opaque.
                    }
                });
                frame.putImageData(imgData, img.leftPos, img.topPos);
                lastImg = img;
            };
            function toBlob(imageData) {
                return __awaiter(this, void 0, void 0, function* () {
                    frame.putImageData(imageData, 0, 0);
                    if (tmpCanvas.toBlob) {
                        return new Promise((resolve, reject) => {
                            tmpCanvas.toBlob(resolve);
                        });
                    }
                    else if (tmpCanvas.msToBlob) {
                        // not exactly asynchronous but less blocking in loop
                        yield new Promise(resolve => setTimeout(resolve, 0));
                        return tmpCanvas.msToBlob();
                    }
                });
            }
            return new Promise((resolve, reject) => {
                parseGIF(new Stream(new Uint8Array(buffer)), {
                    hdr: doHdr,
                    gce: doGCE,
                    img: doImg,
                    eof: (block) => __awaiter(this, void 0, void 0, function* () {
                        //toolbar.style.display = '';
                        pushFrame();
                        const blobFrames = [];
                        let duration = 0;
                        for (let frame of frames) {
                            blobFrames.push({
                                blob: yield toBlob(frame.data),
                                delay: frame.delay
                            });
                            duration += frame.delay;
                        }
                        resolve({
                            width: hdr.width,
                            height: hdr.height,
                            frames: blobFrames,
                            duration
                        });
                    })
                });
            });
        });
    }
    GIFExporter.get = get;
    ;
})(GIFExporter || (GIFExporter = {}));
;
//# sourceMappingURL=gif-exporter.js.map