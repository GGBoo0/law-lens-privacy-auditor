export type StructuredTableLimits = {
  maxTables: number;
  maxRowsPerTable: number;
  maxCellsPerRow: number;
  maxCellChars: number;
  maxCellSourceChars: number;
  maxOutputChars: number;
};

export const DEFAULT_STRUCTURED_TABLE_LIMITS: Readonly<StructuredTableLimits> =
  Object.freeze({
    maxTables: 24,
    maxRowsPerTable: 200,
    maxCellsPerRow: 32,
    maxCellChars: 2_000,
    maxCellSourceChars: 16_000,
    maxOutputChars: 180_000,
  });

type HtmlTag = {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  complete: boolean;
};

type ElementRange = {
  name: string;
  contentStart: number;
  contentEnd: number;
  afterEnd: number;
};

type TableCell = {
  kind: "th" | "td";
  text: string;
};

const hiddenInlineTags = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "template",
  "iframe",
]);

class BoundedTextBuilder {
  private readonly chunks: string[] = [];
  private readonly limit: number;
  length = 0;

  constructor(limit: number) {
    this.limit = limit;
  }

  append(value: string) {
    const remaining = this.limit - this.length;
    if (remaining <= 0 || !value) return false;
    const chunk = value.length <= remaining ? value : value.slice(0, remaining);
    this.chunks.push(chunk);
    this.length += chunk.length;
    return chunk.length === value.length;
  }

  get full() {
    return this.length >= this.limit;
  }

  toString() {
    return this.chunks.join("");
  }
}

function findTagEnd(html: string, start: number, limit: number) {
  let quote = "";
  for (let cursor = start + 1; cursor < limit; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  return -1;
}

function readHtmlTag(html: string, start: number, limit: number): HtmlTag {
  if (html.startsWith("<!--", start)) {
    const commentEnd = html.indexOf("-->", start + 4);
    return {
      start,
      end: commentEnd >= 0 && commentEnd + 3 <= limit ? commentEnd + 2 : limit - 1,
      name: "",
      closing: false,
      selfClosing: true,
      complete: commentEnd >= 0 && commentEnd + 3 <= limit,
    };
  }

  const end = findTagEnd(html, start, limit);
  if (end < 0) {
    return {
      start,
      end: limit - 1,
      name: "",
      closing: false,
      selfClosing: false,
      complete: false,
    };
  }

  let cursor = start + 1;
  while (cursor < end && /\s/.test(html[cursor])) cursor += 1;
  const closing = html[cursor] === "/";
  if (closing) {
    cursor += 1;
    while (cursor < end && /\s/.test(html[cursor])) cursor += 1;
  }
  const nameStart = cursor;
  while (cursor < end && /[a-z\d:-]/i.test(html[cursor])) cursor += 1;
  const name = html.slice(nameStart, cursor).toLowerCase();
  let tail = end - 1;
  while (tail > start && /\s/.test(html[tail])) tail -= 1;

  return {
    start,
    end,
    name,
    closing,
    selfClosing: html[tail] === "/",
    complete: true,
  };
}

function findMatchingElementEnd(
  html: string,
  openingTag: HtmlTag,
  limit: number,
): HtmlTag | null {
  let depth = 1;
  let cursor = openingTag.end + 1;
  while (cursor < limit) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0 || tagStart >= limit) return null;
    const tag = readHtmlTag(html, tagStart, limit);
    if (!tag.complete) return null;
    cursor = tag.end + 1;
    if (tag.name !== openingTag.name) continue;
    if (tag.closing) {
      depth -= 1;
      if (depth === 0) return tag;
    } else if (!tag.selfClosing) {
      depth += 1;
    }
  }
  return null;
}

function collectTopLevelElements(
  html: string,
  start: number,
  end: number,
  names: ReadonlySet<string>,
  maxItems: number,
) {
  const ranges: ElementRange[] = [];
  let cursor = start;
  let nestedTableDepth = 0;

  while (cursor < end && ranges.length < maxItems) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0 || tagStart >= end) break;
    const tag = readHtmlTag(html, tagStart, end);
    if (!tag.complete) break;
    cursor = tag.end + 1;

    if (tag.name === "table") {
      if (tag.closing) {
        nestedTableDepth = Math.max(0, nestedTableDepth - 1);
      } else if (!tag.selfClosing) {
        nestedTableDepth += 1;
      }
      continue;
    }
    if (
      nestedTableDepth > 0 ||
      tag.closing ||
      tag.selfClosing ||
      !names.has(tag.name)
    ) {
      continue;
    }

    const closingTag = findMatchingElementEnd(html, tag, end);
    if (!closingTag) break;
    ranges.push({
      name: tag.name,
      contentStart: tag.end + 1,
      contentEnd: closingTag.start,
      afterEnd: closingTag.end + 1,
    });
    cursor = closingTag.end + 1;
  }
  return ranges;
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    middot: "·",
    bull: "•",
  };
  return value
    .replace(/&([a-z]+);/gi, (entity, name: string) =>
      named[name.toLowerCase()] ?? entity,
    )
    .replace(/&#(\d+);/g, (entity, code: string) => {
      const value = Number(code);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : entity;
    })
    .replace(/&#x([\da-f]+);/gi, (entity, code: string) => {
      const value = Number.parseInt(code, 16);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : entity;
    });
}

function extractCellText(
  html: string,
  start: number,
  end: number,
  limits: StructuredTableLimits,
) {
  const sourceEnd = Math.min(end, start + limits.maxCellSourceChars);
  const raw = new BoundedTextBuilder(limits.maxCellChars * 8);
  const hiddenStack: string[] = [];
  let cursor = start;

  while (cursor < sourceEnd && !raw.full) {
    const tagStart = html.indexOf("<", cursor);
    const textEnd = tagStart < 0 || tagStart >= sourceEnd ? sourceEnd : tagStart;
    if (hiddenStack.length === 0 && textEnd > cursor) {
      raw.append(html.slice(cursor, textEnd));
    }
    if (textEnd >= sourceEnd) break;

    const tag = readHtmlTag(html, tagStart, sourceEnd);
    if (!tag.complete) break;
    cursor = tag.end + 1;

    if (hiddenStack.length > 0) {
      if (tag.closing && tag.name === hiddenStack.at(-1)) {
        hiddenStack.pop();
      } else if (
        !tag.closing &&
        !tag.selfClosing &&
        hiddenInlineTags.has(tag.name)
      ) {
        hiddenStack.push(tag.name);
      }
      continue;
    }
    if (!tag.closing && !tag.selfClosing && hiddenInlineTags.has(tag.name)) {
      hiddenStack.push(tag.name);
    } else if (!tag.closing && (tag.name === "br" || tag.name === "hr")) {
      raw.append(" / ");
    }
  }

  return decodeEntities(raw.toString())
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limits.maxCellChars);
}

function formatStructuredTable(
  html: string,
  start: number,
  end: number,
  limits: StructuredTableLimits,
  outputLimit: number,
) {
  const rowRanges = collectTopLevelElements(
    html,
    start,
    end,
    new Set(["tr"]),
    limits.maxRowsPerTable,
  );
  const rows = rowRanges
    .map((row) =>
      collectTopLevelElements(
        html,
        row.contentStart,
        row.contentEnd,
        new Set(["th", "td"]),
        limits.maxCellsPerRow,
      )
        .map((cell): TableCell => ({
          kind: cell.name as TableCell["kind"],
          text: extractCellText(
            html,
            cell.contentStart,
            cell.contentEnd,
            limits,
          ),
        }))
        .filter((cell) => cell.text),
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0 || outputLimit <= 0) return " ";

  const output = new BoundedTextBuilder(outputLimit);
  const headerRow = rows[0].every((cell) => cell.kind === "th")
    ? rows[0].map((cell) => cell.text)
    : null;
  output.append("\n[표 시작]\n");

  for (let rowIndex = 0; rowIndex < rows.length && !output.full; rowIndex += 1) {
    const row = rows[rowIndex];
    if (rowIndex === 0 && headerRow) {
      output.append("표 항목: ");
      for (let index = 0; index < headerRow.length && !output.full; index += 1) {
        if (index > 0) output.append(" | ");
        output.append(headerRow[index]);
      }
    } else if (headerRow && headerRow.length === row.length) {
      for (let index = 0; index < row.length && !output.full; index += 1) {
        if (index > 0) output.append(" | ");
        output.append(headerRow[index]);
        output.append(": ");
        output.append(row[index].text);
      }
    } else {
      for (let index = 0; index < row.length && !output.full; index += 1) {
        if (index > 0) output.append(" | ");
        output.append(row[index].kind === "th" ? "항목: " : "내용: ");
        output.append(row[index].text);
      }
    }
    output.append("\n");
  }
  output.append("[표 끝]\n");
  return output.toString();
}

export function extractStructuredTables(
  html: string,
  overrides: Partial<StructuredTableLimits> = {},
) {
  const limits = { ...DEFAULT_STRUCTURED_TABLE_LIMITS, ...overrides };
  const output: string[] = [];
  let copiedThrough = 0;
  let cursor = 0;
  let tableCount = 0;
  let structuredOutputLength = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    const tag = readHtmlTag(html, tagStart, html.length);
    if (!tag.complete) break;
    cursor = tag.end + 1;
    if (tag.name !== "table" || tag.closing || tag.selfClosing) continue;

    output.push(html.slice(copiedThrough, tag.start));
    const closingTag = findMatchingElementEnd(html, tag, html.length);
    if (!closingTag) {
      // The remainder belongs to a malformed table. Dropping it avoids both
      // overlapping rescans and feeding unbounded malformed markup downstream.
      if (structuredOutputLength < limits.maxOutputChars) {
        output.push(" ");
        structuredOutputLength += 1;
      }
      copiedThrough = html.length;
      cursor = html.length;
      break;
    }

    const remainingOutput = Math.max(
      0,
      limits.maxOutputChars - structuredOutputLength,
    );
    const replacement =
      remainingOutput <= 0
        ? ""
        : tableCount < limits.maxTables
          ? formatStructuredTable(
              html,
              tag.end + 1,
              closingTag.start,
              limits,
              remainingOutput,
            )
          : " ";
    output.push(replacement);
    structuredOutputLength += replacement.length;
    tableCount += 1;
    copiedThrough = closingTag.end + 1;
    cursor = closingTag.end + 1;
  }

  if (copiedThrough < html.length) output.push(html.slice(copiedThrough));
  return output.join("");
}
