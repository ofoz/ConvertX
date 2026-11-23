import { getFormatCatalog, getFormatStats } from "../helpers/formatCatalog";
import { SymbolIcon } from "./symbol";

export function FormatLibrary({
  webroot = "",
  full = false,
}: {
  webroot?: string;
  full?: boolean;
}) {
  const groups = getFormatCatalog();
  const stats = getFormatStats(groups);
  return (
    <section id="formats" class={`
      cx-library
      ${full ? "cx-library-full" : ""}
    `} data-format-library>
      <div class="cx-section-heading">
        <div>
          <p class="eyebrow">THE FORMAT UNIVERSE</p>
          <h2>{full ? "全部支持格式" : "支持什么格式？这里全部列清楚。"}</h2>
          <p class="muted">按用途浏览，或直接搜索格式。点击输出格式，可带着目标回到转换台。</p>
        </div>
        {!full && (
          <a class="cx-text-link" href={`${webroot}/converters`}>
            打开完整格式库 <SymbolIcon name="arrow" size={16} />
          </a>
        )}
      </div>
      <div class="cx-library-toolbar surface">
        <label class="cx-search-field" for="catalog-search">
          <SymbolIcon name="search" size={18} />
          <input
            id="catalog-search"
            type="search"
            placeholder="搜索格式或分类，例如 PDF、JPG、视频"
            aria-label="搜索支持格式"
            autocomplete="off"
            data-catalog-search
          />
        </label>
        <div class="cx-direction-control" role="group" aria-label="格式方向">
          <button type="button" data-format-direction="all" class="is-active" aria-pressed="true">
            全部
          </button>
          <button type="button" data-format-direction="input" aria-pressed="false">
            可输入
          </button>
          <button type="button" data-format-direction="output" aria-pressed="false">
            可输出
          </button>
        </div>
        <button class="cx-expand-button" type="button" data-expand-catalog aria-expanded="false">
          全部展开 <SymbolIcon name="chevron" size={15} />
        </button>
      </div>
      <div class="cx-category-filters" role="group" aria-label="按用途筛选">
        <button type="button" data-category-filter="all" class="is-active" aria-pressed="true">
          全部分类 <span>{groups.length}</span>
        </button>
        {groups.map((group) => (
          <button type="button" data-category-filter={group.id} aria-pressed="false" safe>
            {group.title}
          </button>
        ))}
      </div>
      <p class="cx-catalog-count muted" data-catalog-count aria-live="polite">
        {stats.groups} 个分类 · {stats.formats} 种格式
      </p>
      <div class="cx-category-grid">
        {groups.map((group) => (
          <details
            id={`category-${group.id}`}
            class="cx-category surface"
            data-format-category={group.id}
            data-category-search={`${group.title} ${group.label} ${group.description} ${group.converters.join(" ")}`}
          >
            <summary>
              <span class="cx-category-symbol" aria-hidden="true">
                <SymbolIcon name={group.icon} size={23} />
              </span>
              <span class="cx-category-copy">
                <span class="cx-category-label" safe>
                  {group.label}
                </span>
                <strong safe>{group.title}</strong>
                <span class="cx-category-description" safe>
                  {group.description}
                </span>
                <span class="cx-category-examples" safe>
                  {group.examples.join(" / ")}
                </span>
              </span>
              <span class="cx-category-meta">
                <b>{group.formats.length}</b>
                <span>种格式</span>
                <SymbolIcon name="chevron" size={17} />
              </span>
            </summary>
            <div class="cx-category-content">
              <div class="cx-format-direction" data-direction-section="input">
                <h3>
                  <span class="cx-direction-dot" />
                  可输入 <small>{group.inputs.length}</small>
                </h3>
                <div class="cx-format-tags">
                  {group.inputs.map((format) => (
                    <span
                      class="cx-format-tag"
                      data-format-token={format}
                      data-format-kind="input"
                      safe
                    >
                      {format}
                    </span>
                  ))}
                </div>
              </div>
              <div class="cx-format-direction" data-direction-section="output">
                <h3>
                  <span class="cx-direction-dot cx-output-dot" />
                  可输出 <small>{group.outputs.length}</small>
                </h3>
                <div class="cx-format-tags">
                  {group.outputs.map((format) => (
                    <a
                      class="cx-format-tag cx-format-tag-link"
                      data-format-token={format}
                      data-format-kind="output"
                      href={`${webroot}/?to=${encodeURIComponent(format)}`}
                      title={`选择 ${format.toUpperCase()} 作为输出格式`}
                      safe
                    >
                      {format}
                    </a>
                  ))}
                </div>
              </div>
              <p class="cx-category-engines">
                转换引擎 <span safe>{group.converters.join(" · ")}</span>
              </p>
            </div>
          </details>
        ))}
      </div>
      <div class="cx-catalog-empty surface" data-catalog-empty hidden>
        <SymbolIcon name="search" size={28} />
        <h3>没有找到这个格式</h3>
        <p>试试其他扩展名，或清除分类与方向筛选。</p>
        <button type="button" class="btn-secondary" data-reset-catalog>
          清除筛选
        </button>
      </div>
      <p class="cx-catalog-footnote">
        格式清单来自 {stats.converters}{" "}
        个已注册转换引擎。同一格式可出现在多个用途分类；总数已去重。先选目标格式，上传后会检查这组输入与输出是否支持转换。
      </p>
    </section>
  );
}
