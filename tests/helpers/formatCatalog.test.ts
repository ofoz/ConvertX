import { describe, expect, test } from "bun:test";

import { getAllInputs, getAllTargets } from "../../src/converters/main";
import { getFormatCatalog, getFormatStats } from "../../src/helpers/formatCatalog";

const unique = (values: string[]) => [...new Set(values)].sort();

describe("format catalogue", () => {
  test("assigns every registered engine to one purpose group", () => {
    const engines = getFormatCatalog().flatMap((group) => group.converters);
    expect(engines.length).toBe(new Set(engines).size);
    expect(engines.sort()).toEqual(Object.keys(getAllTargets()).sort());
  });

  test("includes all registered input and output formats without invented entries", () => {
    const targets = getAllTargets();
    for (const group of getFormatCatalog()) {
      const expectedInputs = unique(group.converters.flatMap((engine) => getAllInputs(engine)));
      const expectedOutputs = unique(group.converters.flatMap((engine) => targets[engine] ?? []));
      expect([...group.inputs].sort()).toEqual(expectedInputs);
      expect([...group.outputs].sort()).toEqual(expectedOutputs);
      expect([...group.formats].sort()).toEqual(unique([...expectedInputs, ...expectedOutputs]));
    }
  });

  test("counts formats globally without adding duplicates across categories", () => {
    const targets = getAllTargets();
    const inputs = Object.keys(targets).flatMap((engine) => getAllInputs(engine));
    const outputs = Object.values(targets).flat();
    const stats = getFormatStats();
    expect(stats.inputs).toBe(new Set(inputs).size);
    expect(stats.outputs).toBe(new Set(outputs).size);
    expect(stats.formats).toBe(new Set([...inputs, ...outputs]).size);
    expect(stats.converters).toBe(Object.keys(targets).length);
    expect(stats.groups).toBe(8);
  });

  test("keeps public format tokens curated and excludes internal or obscure targets", () => {
    const tokens = new Set(getFormatCatalog().flatMap((group) => group.formats));
    for (const token of ["exr", "jxl", "emf", "wav-3cx", "h264.mp4", "glb2", "gltf2", "stlb"])
      expect(tokens.has(token)).toBe(false);
    for (const token of ["pdf", "docx", "png", "jpeg", "mp4", "mp3", "json", "csv", "epub"])
      expect(tokens.has(token)).toBe(true);
  });

  test("keeps the source registry unchanged and examples inside the actual format set", () => {
    const before = JSON.stringify(getAllTargets());
    for (const group of getFormatCatalog()) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.examples.length).toBeGreaterThan(0);
      for (const example of group.examples) expect(group.formats).toContain(example);
    }
    expect(JSON.stringify(getAllTargets())).toBe(before);
  });
});
