declare namespace GIFExporter {
    interface Frame {
        blob: Blob;
        delay: number;
    }
    interface ExportResult {
        width: number;
        height: number;
        duration: number;
        frames: Frame[];
    }
    function get(input: ArrayBuffer | Blob): Promise<ExportResult>;
}
