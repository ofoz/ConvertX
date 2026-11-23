import { getAllInputs, getAllTargets } from "../converters/main";

type CategoryIcon = "file" | "layers" | "sparkles" | "arrow" | "grid";
type CategoryDefinition = {
  id: string;
  title: string;
  label: string;
  description: string;
  icon: CategoryIcon;
  converters: string[];
};

export type FormatCategory = CategoryDefinition & {
  inputs: string[];
  outputs: string[];
  formats: string[];
  examples: string[];
};

const definitions: CategoryDefinition[] = [
  {
    id: "documents",
    title: "办公文档与 PDF",
    label: "DOCUMENTS",
    description: "文稿、表格、扫描文档与 PDF",
    icon: "file",
    converters: ["libreoffice", "pdf2docx", "djvu", "pdftops"],
  },
  {
    id: "images",
    title: "图片与照片",
    label: "IMAGES",
    description: "常见图片、专业图像与新一代图片格式",
    icon: "layers",
    converters: ["vips", "imagemagick", "graphicsmagick", "libheif", "libjxl"],
  },
  {
    id: "vectors",
    title: "矢量与绘图",
    label: "VECTORS",
    description: "矢量图、图像描摹与绘图文件",
    icon: "sparkles",
    converters: ["inkscape", "resvg", "potrace", "vtracer", "dvisvgm"],
  },
  {
    id: "media",
    title: "音频与视频",
    label: "AUDIO / VIDEO",
    description: "音视频容器、编码与媒体格式",
    icon: "arrow",
    converters: ["ffmpeg"],
  },
  {
    id: "ebooks",
    title: "电子书",
    label: "EBOOKS",
    description: "阅读器、电子书与漫画文档",
    icon: "file",
    converters: ["calibre"],
  },
  {
    id: "models",
    title: "三维模型",
    label: "3D ASSETS",
    description: "建模、打印与三维资源交换",
    icon: "layers",
    converters: ["assimp"],
  },
  {
    id: "markup",
    title: "标记与排版",
    label: "MARKUP / TYPESETTING",
    description: "Markdown、网页、LaTeX 与文档排版",
    icon: "file",
    converters: ["pandoc", "markitDown", "xelatex"],
  },
  {
    id: "data",
    title: "数据、邮件与联系人",
    label: "DATA / MAIL",
    description: "结构化数据、邮件与通讯录",
    icon: "grid",
    converters: ["dasel", "msgconvert", "vcf"],
  },
];

const preferredExamples = [
  "pdf",
  "docx",
  "xlsx",
  "png",
  "jpeg",
  "webp",
  "heic",
  "avif",
  "svg",
  "eps",
  "mp4",
  "mp3",
  "wav",
  "flac",
  "epub",
  "mobi",
  "azw3",
  "obj",
  "stl",
  "gltf",
  "markdown",
  "html",
  "latex",
  "json",
  "yaml",
  "csv",
  "eml",
  "vcf",
];
const uniqueSorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

// Derive every entry from the actual registry. Unknown future engines get their
// own group instead of silently disappearing from the catalogue.
export function getFormatCatalog(): FormatCategory[] {
  const targets = getAllTargets();
  const known = new Set(definitions.flatMap((definition) => definition.converters));
  const unknown = Object.keys(targets).filter((name) => !known.has(name));
  const groups: CategoryDefinition[] = [...definitions];
  if (unknown.length)
    groups.push({
      id: "other",
      title: "其他专业格式",
      label: "MORE FORMATS",
      description: "其他已注册转换器的专业格式",
      icon: "grid",
      converters: unknown,
    });
  return groups
    .map((definition) => {
      const converters = definition.converters.filter((name) => name in targets);
      const inputs = uniqueSorted(converters.flatMap((name) => getAllInputs(name)));
      const outputs = uniqueSorted(converters.flatMap((name) => targets[name] ?? []));
      const formats = uniqueSorted([...inputs, ...outputs]);
      const examples = preferredExamples.filter((format) => formats.includes(format)).slice(0, 5);
      for (const format of formats) {
        if (examples.length >= Math.min(5, formats.length)) break;
        if (!examples.includes(format)) examples.push(format);
      }
      return { ...definition, converters, inputs, outputs, formats, examples };
    })
    .filter((group) => group.formats.length > 0);
}

export function getFormatStats(groups = getFormatCatalog()) {
  return {
    inputs: new Set(groups.flatMap((group) => group.inputs)).size,
    outputs: new Set(groups.flatMap((group) => group.outputs)).size,
    formats: new Set(groups.flatMap((group) => group.formats)).size,
    converters: Object.keys(getAllTargets()).length,
    groups: groups.length,
  };
}

export const formatDescription = (format: string): string =>
  (
    ({
      pdf: "PDF 文档",
      docx: "Word 文档",
      doc: "Word 文档",
      xlsx: "Excel 表格",
      xls: "Excel 表格",
      pptx: "演示文稿",
      odt: "开放文档",
      rtf: "富文本文档",
      txt: "纯文本",
      png: "透明背景图片",
      jpeg: "通用照片格式",
      jpg: "通用照片格式",
      webp: "网页图片",
      avif: "高效图片",
      heic: "HEIF 照片",
      jxl: "JPEG XL 图片",
      svg: "矢量图片",
      gif: "GIF 图片",
      tiff: "高质量图像",
      mp4: "通用视频",
      "h264.mp4": "H.264 视频",
      webm: "网页视频",
      mov: "QuickTime 视频",
      mp3: "通用音频",
      wav: "无压缩音频",
      flac: "无损音频",
      aac: "AAC 音频",
      epub: "电子书",
      mobi: "Kindle 电子书",
      csv: "表格数据",
      json: "JSON 数据",
      yaml: "YAML 数据",
      html: "网页文档",
      markdown: "Markdown 文档",
      markdown_strict: "Markdown 文档",
      latex: "LaTeX 文稿",
      obj: "三维模型",
      stl: "三维打印模型",
      glb2: "二进制三维模型",
      eml: "电子邮件",
      ps: "PostScript 文档",
    }) as Record<string, string>
  )[format] ?? `${format.toUpperCase()} 格式`;
