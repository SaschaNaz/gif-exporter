# GIF Exporter

Exports dependent/independent PNG frames from GIFs. Sample page [here](https://saschanaz.github.io/gif-exporter/).

# API

Simple use:

```ts
GIFExporter.get(gifFile);
```

Detail:

```ts
declare namespace GIFExporter {
    interface Frame<T> {
        image: T;
        delay: number;
    }
    interface ExportResult<T> {
        width: number;
        height: number;
        duration: number;
        frames: Frame<T>[];
    }
    function get(input: ArrayBuffer | Blob, resultType?: "blob"): Promise<ExportResult<Blob>>;
    function get(input: ArrayBuffer | Blob, resultType: "imagedata"): Promise<ExportResult<ImageData>>;
    function get(input: ArrayBuffer | Blob, resultType?: "imagedata" | "blob"): Promise<ExportResult<ImageData | Blob>>;
}
```
