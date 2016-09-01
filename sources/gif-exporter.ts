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
namespace GIFExporter {
    // Generic functions
    function bitsToNum(ba: boolean[]) {
        return ba.reduce((s, n) => s * 2 + Number(n), 0);
    };

    function byteToBitArr(bite: number) {
        const a: boolean[] = [];
        for (let i = 7; i >= 0; i--) {
            a.push(!!(bite & (1 << i)));
        }
        return a;
    };

    // Stream
    class Stream {
        data: Uint8Array;
        position: number;

        constructor(data: Uint8Array) {
            this.data = data;
            this.position = 0;
        }

        readByte() {
            if (this.position >= this.data.length) {
                throw new Error('Attempted to read past end of stream.');
            }
            return this.data[this.position++];
        };

        readBytes(n: number) {
            const bytes: number[] = [];
            for (let i = 0; i < n; i++) {
                bytes.push(this.readByte());
            }
            return bytes;
        };

        read(n: number) {
            let s = '';
            for (let i = 0; i < n; i++) {
                s += String.fromCharCode(this.readByte());
            }
            return s;
        };

        readUnsigned() { // Little-endian.
            const a = this.readBytes(2);
            return (a[1] << 8) + a[0];
        };
    };

    function lzwDecode(minCodeSize: number, data: string) {
        // TODO: Now that the GIF parser is a bit different, maybe this should get an array of bytes instead of a String?
        let pos = 0; // Maybe this streaming thing should be merged with the Stream?
        const readCode = (size: number) => {
            let code = 0;
            for (let i = 0; i < size; i++) {
                if (data.charCodeAt(pos >> 3) & (1 << (pos & 7))) {
                    code |= 1 << i;
                }
                pos++;
            }
            return code;
        };

        const output: number[] = [];

        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;

        let codeSize = minCodeSize + 1;

        const dict: number[][] = [];

        const clear = () => {
            dict.length = 0;
            codeSize = minCodeSize + 1;
            for (let i = 0; i < clearCode; i++) {
                dict[i] = [i];
            }
            dict[clearCode] = [];
            dict[eoiCode] = null;

        };

        let code: number;
        let last: number;

        while (true) {
            last = code;
            code = readCode(codeSize);

            if (code === clearCode) {
                clear();
                continue;
            }
            if (code === eoiCode) break;

            if (code < dict.length) {
                if (last !== clearCode) {
                    dict.push(dict[last].concat(dict[code][0]));
                }
            }
            else {
                if (code !== dict.length) throw new Error('Invalid LZW code.');
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
    };

    interface Header {
        sig: string;
        ver: string;
        width: number;
        height: number;
        gctFlag: boolean;
        colorRes: number;
        sorted: boolean;
        gctSize: number;
        bgColor: number;
        pixelAspectRatio: number;
        gct: number[][];
    }

    interface Block {
        sentinel: number;
        type: string;
    }

    interface ExtBlock extends Block {
        label: number;
        extType: string;
    }
    type ExtBlocks = GCExtBlock | CommentExtBlock | PTExtBlock | AppExtBlock | UnknownExtBlock;

    interface GCExtBlock extends ExtBlock {
        label: number; // 0xF9;
        extType: "gce";
        reserved: boolean[];
        disposalMethod: number;
        userInput: boolean;
        transparencyGiven: boolean;

        delayTime: number;
        transparencyIndex: number;
        terminator: number;
    }

    interface CommentExtBlock extends ExtBlock {
        label: number; // 0xFE;
        extType: "com";
        comment: string;
    }

    interface PTExtBlock extends ExtBlock {
        label: number; // 0x01;
        extType: "gce";
        ptHeader: number[];
        ptData: string;
    }

    interface AppExtBlock extends ExtBlock {
        label: number; // 0xFF;
        extType: "app";
        identifier: string;
        authCode: string;
    }

    interface NetscapeAppExtBlock extends AppExtBlock {
        unknown: number;
        iterations: number;
        terminator: number;
    }

    interface UnknownAppExtBlock extends AppExtBlock {
        appData: string;
    }

    interface UnknownExtBlock extends ExtBlock {
        label: number;
        extType: string;
        data: string;
    }

    interface ImageBlock extends Block {
        leftPos: number;
        topPos: number;
        width: number;
        height: number;

        lctFlag: boolean;
        interlaced: boolean;
        sorted: boolean;
        reserved: boolean[];
        lctSize: number;
        lct: number[][];

        lzwMinCodeSize: number;
        pixels: number[];
    }

    interface ParserHandler {
        hdr?: (block: Header) => void;
        gce?: (block: GCExtBlock) => void;
        com?: (block: CommentExtBlock) => void;
        pte?: (block: PTExtBlock) => void;
        app?: {
            NETSCAPE?: (block: NetscapeAppExtBlock) => void;
        }
        img?: (block: ImageBlock) => void;
        eof?: (block: Block) => void;
        unknown?: (block: Block) => void;
    }

    // The actual parsing; returns an object with properties.
    function parseGIF(st: Stream, handler: ParserHandler) {
        handler || (handler = {});

        // LZW (GIF-specific)
        const parseCT = (entries: number) => { // Each entry is 3 bytes, for RGB.
            const ct: number[][] = [];
            for (let i = 0; i < entries; i++) {
                ct.push(st.readBytes(3));
            }
            return ct;
        };

        const readSubBlocks = () => {
            let size: number;
            let data = '';
            do {
                size = st.readByte();
                data += st.read(size);
            } while (size !== 0);
            return data;
        };

        const parseHeader = () => {
            const hdr = {} as Header;
            hdr.sig = st.read(3);
            hdr.ver = st.read(3);
            if (hdr.sig !== 'GIF') throw new Error('Not a GIF file.'); // XXX: This should probably be handled more nicely.
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

        const parseExt = (block: ExtBlock) => {
            const parseGCExt = (block: GCExtBlock) => {
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

            const parseComExt = (block: CommentExtBlock) => {
                block.comment = readSubBlocks();
                handler.com && handler.com(block);
            };

            const parsePTExt = (block: PTExtBlock) => {
                // No one *ever* uses this. If you use it, deal with parsing it yourself.
                const blockSize = st.readByte(); // Always 12
                block.ptHeader = st.readBytes(12);
                block.ptData = readSubBlocks();
                handler.pte && handler.pte(block);
            };

            const parseAppExt = (block: AppExtBlock) => {
                const parseNetscapeExt = (block: NetscapeAppExtBlock) => {
                    const blockSize = st.readByte(); // Always 3
                    block.unknown = st.readByte(); // ??? Always 1? What is this?
                    block.iterations = st.readUnsigned();
                    block.terminator = st.readByte();
                    handler.app && handler.app.NETSCAPE && handler.app.NETSCAPE(block);
                };

                const parseUnknownAppExt = (block: UnknownAppExtBlock) => {
                    block.appData = readSubBlocks();
                    // FIXME: This won't work if a handler wants to match on any identifier.
                    handler.app && handler.app[block.identifier] && handler.app[block.identifier](block);
                };

                const blockSize = st.readByte(); // Always 11
                block.identifier = st.read(8);
                block.authCode = st.read(3);
                switch (block.identifier) {
                    case 'NETSCAPE':
                        parseNetscapeExt(block as NetscapeAppExtBlock);
                        break;
                    default:
                        parseUnknownAppExt(block as UnknownAppExtBlock);
                        break;
                }
            };

            const parseUnknownExt = (block: UnknownExtBlock) => {
                block.data = readSubBlocks();
                handler.unknown && handler.unknown(block);
            };

            block.label = st.readByte();
            switch (block.label) {
                case 0xF9:
                    block.extType = 'gce';
                    parseGCExt(block as GCExtBlock);
                    break;
                case 0xFE:
                    block.extType = 'com';
                    parseComExt(block as CommentExtBlock);
                    break;
                case 0x01:
                    block.extType = 'pte';
                    parsePTExt(block as PTExtBlock);
                    break;
                case 0xFF:
                    block.extType = 'app';
                    parseAppExt(block as AppExtBlock);
                    break;
                default:
                    block.extType = 'unknown';
                    parseUnknownExt(block as UnknownExtBlock);
                    break;
            }
        };

        const parseImg = (img: ImageBlock) => {
            const deinterlace = (pixels: number[], width: number) => {
                // Of course this defeats the purpose of interlacing. And it's *probably*
                // the least efficient way it's ever been implemented. But nevertheless...
                const newPixels = new Array<number>(pixels.length);
                const rows = pixels.length / width;
                const cpRow = (toRow: number, fromRow: number) => {
                    const fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
                    newPixels.splice.apply(newPixels, [toRow * width, width].concat(fromPixels));
                };

                // See appendix E.
                const offsets = [0, 4, 2, 1];
                const steps = [8, 8, 4, 2];

                let fromRow = 0;
                for (let pass = 0; pass < 4; pass++) {
                    for (let toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
                        cpRow(toRow, fromRow)
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

            if (img.interlaced) { // Move
                img.pixels = deinterlace(img.pixels, img.width);
            }

            handler.img && handler.img(img);
        };

        const parseBlock = () => {
            const block = {} as Block;
            block.sentinel = st.readByte();

            switch (String.fromCharCode(block.sentinel)) { // For ease of matching
                case '!':
                    block.type = 'ext';
                    parseExt(block as ExtBlock);
                    break;
                case ',':
                    block.type = 'img';
                    parseImg(block as ImageBlock);
                    break;
                case ';':
                    block.type = 'eof';
                    handler.eof && handler.eof(block);
                    break;
                default:
                    throw new Error('Unknown block: 0x' + block.sentinel.toString(16)); // TODO: Pad this with a 0.
            }

            if (block.type !== 'eof') setTimeout(parseBlock, 0);
        };

        const parse = () => {
            parseHeader();
            setTimeout(parseBlock, 0);
        };

        parse();
    };

    function toArrayBuffer(blob: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = err => reject(err);
            reader.onload = () => resolve(reader.result);
            reader.readAsArrayBuffer(blob);
        });
    }

    interface ImageDataFrame { data: ImageData, delay: number }
    export interface Frame { blob: Blob, delay: number }
    export interface ExportResult {
        width: number;
        height: number;
        duration: number;
        frames: Frame[];
    }

    export async function get(input: ArrayBuffer | Blob) {
        const buffer = input instanceof Blob ? await toArrayBuffer(input) : input;

        const tmpCanvas = document.createElement('canvas');
        let frame: CanvasRenderingContext2D;

        let hdr: Header;

        let transparency: number;
        let delay: number;
        let disposalMethod: number;
        let disposalRestoreFromIdx: number;
        let lastDisposalMethod: number;
        let lastImg: ImageBlock;

        const frames: ImageDataFrame[] = [];

        const clear = () => {
            transparency = null;
            delay = null;
            lastDisposalMethod = disposalMethod;
            disposalMethod = null;
            frame = null;
        };

        const setSizes = (w: number, h: number) => {
            tmpCanvas.width = w;
            tmpCanvas.height = h;
        };

        const doHdr = (_hdr: Header) => {
            hdr = _hdr;
            setSizes(hdr.width, hdr.height)
        };

        const doGCE = (gce: GCExtBlock) => {
            pushFrame();
            clear();
            transparency = gce.transparencyGiven ? gce.transparencyIndex : null;
            delay = gce.delayTime;
            disposalMethod = gce.disposalMethod;
            // We don't have much to do with the rest of GCE.
        };

        const pushFrame = () => {
            if (!frame) return;
            frames.push({
                data: frame.getImageData(0, 0, hdr.width, hdr.height),
                delay
            });
        };

        const doImg = (img: ImageBlock) => {
            if (!frame) frame = tmpCanvas.getContext('2d');

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
                    } else {
                        frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
                    }
                } else {
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

        async function toBlob(imageData: ImageData) {
            frame.putImageData(imageData, 0, 0);

            if (tmpCanvas.toBlob) {
                return new Promise<Blob>((resolve, reject) => {
                    (tmpCanvas as any).toBlob(resolve);
                });
            }
            else if (tmpCanvas.msToBlob) {
                // not exactly asynchronous but less blocking in loop
                await new Promise(resolve => setTimeout(resolve, 0));
                return tmpCanvas.msToBlob();
            }
        }

        return new Promise<ExportResult>((resolve, reject) => {
            parseGIF(new Stream(new Uint8Array(buffer)), {
                hdr: doHdr,
                gce: doGCE,
                img: doImg,
                eof: async (block: Block) => {
                    //toolbar.style.display = '';
                    pushFrame();

                    const blobFrames: Frame[] = [];
                    let duration = 0;
                    for (let frame of frames) {
                        blobFrames.push({
                            blob: await toBlob(frame.data),
                            delay: frame.delay
                        })
                        duration += frame.delay;
                    }

                    resolve({
                        width: hdr.width,
                        height: hdr.height,
                        frames: blobFrames,
                        duration
                    });
                }
            });
        });
    };
};


