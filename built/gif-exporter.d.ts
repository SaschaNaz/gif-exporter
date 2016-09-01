declare namespace GIFExporter {
    interface Options {
        gif: HTMLImageElement;
        loop_mode?: boolean;
        auto_play?: boolean;
        max_width?: number;
        on_end?: any;
        loop_delay?: number;
        draw_while_loading?: boolean;
        show_progress_bar?: boolean;
        progressbar_height?: number;
        progressbar_background_color?: string;
        progressbar_foreground_color?: string;
        vp_l?: number;
        vp_t?: number;
        vp_w?: number;
        vp_h?: number;
        c_w?: number;
        c_h?: number;
    }
    interface FrameOffset {
        x: number;
        y: number;
    }
    interface Callback {
        (gif: HTMLImageElement): any;
    }
    var SuperGif: (opts: Options) => {
        play: () => void;
        pause: () => void;
        move_relative: (amount: number) => void;
        move_to: (frame_idx: number) => void;
        get_playing: () => boolean;
        get_canvas: () => HTMLCanvasElement;
        get_canvas_scale: () => number;
        get_loading: () => boolean;
        get_auto_play: () => boolean;
        get_length: () => number;
        get_current_frame: () => number;
        load_url: (src: string, callback: Callback) => void;
        load: (callback: Callback) => void;
        load_raw: (arr: Uint8Array, callback: Callback) => void;
        set_frame_offset: (frame: number, offset: FrameOffset) => void;
    };
}
