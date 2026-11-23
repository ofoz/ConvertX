document.querySelectorAll("[data-format-library]").forEach((library) => {
  const search = library.querySelector("[data-catalog-search]");
  const groups = [...library.querySelectorAll("[data-format-category]")];
  const count = library.querySelector("[data-catalog-count]");
  const empty = library.querySelector("[data-catalog-empty]");
  const expand = library.querySelector("[data-expand-catalog]");
  let category = "all";
  let direction = "all";
  const normalize = (text) => {
    const value = text.trim().toLowerCase().replace(/^\./, "");
    return (
      { jpg: "jpeg", jfif: "jpeg", md: "markdown", tex: "latex", yml: "yaml", tif: "tiff" }[
        value
      ] || value
    );
  };

  function update() {
    const query = normalize(search.value);
    const visibleFormats = new Set();
    let visibleGroups = 0;
    groups.forEach((group) => {
      const categoryMatches = category === "all" || group.dataset.formatCategory === category;
      const textMatches = group.dataset.categorySearch.toLowerCase().includes(query);
      let matches = 0;
      group.querySelectorAll("[data-format-token]").forEach((token) => {
        const match =
          categoryMatches &&
          (direction === "all" || token.dataset.formatKind === direction) &&
          (!query || textMatches || token.dataset.formatToken.toLowerCase().includes(query));
        token.hidden = !match;
        if (match) {
          matches += 1;
          visibleFormats.add(token.dataset.formatToken);
        }
      });
      group.querySelectorAll("[data-direction-section]").forEach((section) => {
        section.hidden = ![...section.querySelectorAll("[data-format-token]")].some(
          (token) => !token.hidden,
        );
      });
      group.hidden = !categoryMatches || matches === 0;
      if (!group.hidden) {
        visibleGroups += 1;
        if (query || category !== "all") group.open = true;
      }
    });
    empty.hidden = visibleGroups !== 0;
    count.textContent = `${visibleGroups} 个分类 · ${visibleFormats.size} 种格式`;
    library.querySelectorAll("[data-category-filter]").forEach((button) => {
      const active = button.dataset.categoryFilter === category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    library.querySelectorAll("[data-format-direction]").forEach((button) => {
      const active = button.dataset.formatDirection === direction;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  search.addEventListener("input", update);
  library.addEventListener("click", (event) => {
    const categoryButton = event.target.closest("[data-category-filter]");
    const directionButton = event.target.closest("[data-format-direction]");
    if (categoryButton) {
      category = categoryButton.dataset.categoryFilter;
      update();
    }
    if (directionButton) {
      direction = directionButton.dataset.formatDirection;
      update();
    }
    if (event.target.closest("[data-reset-catalog]")) {
      category = "all";
      direction = "all";
      search.value = "";
      update();
      search.focus();
    }
    if (event.target.closest("[data-expand-catalog]")) {
      const visible = groups.filter((group) => !group.hidden);
      const open = visible.some((group) => !group.open);
      visible.forEach((group) => {
        group.open = open;
      });
    }
  });
  groups.forEach((group) =>
    group.addEventListener("toggle", () => {
      const visible = groups.filter((item) => !item.hidden);
      const allOpen = visible.length > 0 && visible.every((item) => item.open);
      expand.setAttribute("aria-expanded", String(allOpen));
      expand.firstChild.textContent = allOpen ? "全部收起 " : "全部展开 ";
    }),
  );
  const hash = window.location.hash.slice(1);
  const selected = groups.find((group) => group.id === hash);
  if (selected) selected.open = true;
  update();
});
