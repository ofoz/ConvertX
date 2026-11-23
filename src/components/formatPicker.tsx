import { formatDescription } from "../helpers/formatCatalog";
import { SymbolIcon } from "./symbol";

const popular = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "png",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "mp4",
  "mp3",
  "wav",
  "flac",
  "epub",
  "csv",
  "json",
  "txt",
  "markdown",
];

export function FormatPicker({
  targets,
  disabled = false,
}: {
  targets: Record<string, string[]>;
  disabled?: boolean;
}) {
  const choices = new Map<string, string>();
  for (const [converter, formats] of Object.entries(targets)) {
    for (const format of formats) if (!choices.has(format)) choices.set(format, converter);
  }
  const sorted = [...choices].sort(([a], [b]) => {
    const ai = popular.indexOf(a);
    const bi = popular.indexOf(b);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.localeCompare(b);
  });
  return (
    <article class="cx-picker" data-options-count={choices.size}>
      <label class="cx-search-field" for="target-search">
        <SymbolIcon name="search" size={18} />
        <input
          id="target-search"
          type="search"
          name="convert_to_search"
          placeholder="搜索格式，例如 DOCX、PNG、MP3"
          autocomplete="off"
          aria-label="搜索目标格式"
          aria-controls="format-options"
          disabled={disabled}
        />
        <span class="cx-key-hint" aria-hidden="true">
          ↵
        </span>
      </label>
      <div class="cx-options-caption">
        <span id="format-options-label" safe>
          {disabled ? "上传后自动匹配可用格式" : `可选目标格式 · ${choices.size}`}
        </span>
        <span class="cx-options-hint">点击选择</span>
      </div>
      {choices.size > 0 ? (
        <div
          id="format-options"
          class="convert_to_group cx-format-options"
          role="group"
          aria-labelledby="format-options-label"
        >
          {sorted.map(([format, converter]) => (
            <button
              type="button"
              class="target cx-target"
              data-value={`${format},${converter}`}
              data-target={format}
              data-converter={converter}
              title={`${format.toUpperCase()} · ${formatDescription(format)}`}
              aria-pressed="false"
              disabled={disabled}
            >
              <span class="cx-target-ext" safe>
                {format}
              </span>
              <span class="cx-target-description" safe>
                {formatDescription(format)}
              </span>
              <span class="cx-target-check" aria-hidden="true">
                <SymbolIcon name="check" size={15} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div class="cx-picker-empty">
          这个文件类型暂时没有可用的转换格式。可在格式库中查看支持范围。
        </div>
      )}
      <p id="target-search-empty" class="cx-picker-empty" hidden>
        没有找到匹配格式，试试其他关键词。
      </p>
      <select name="convert_to" aria-label="目标格式" required hidden>
        <option selected disabled value="">
          请选择目标格式
        </option>
        {Object.entries(targets).map(([converter, formats]) => (
          <optgroup label={converter}>
            {formats.map((format) => (
              <option value={`${format},${converter}`} safe>
                {format}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <details class="cx-advanced">
        <summary>
          高级选项 <span>选择转换引擎</span>
        </summary>
        <label for="engine-choice">转换引擎</label>
        <select id="engine-choice" disabled>
          <option value="">选择格式后自动匹配</option>
        </select>
        <p>默认已为当前文件匹配引擎；转换效果不理想时可尝试其他引擎。</p>
      </details>
    </article>
  );
}
