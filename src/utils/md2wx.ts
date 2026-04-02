import { Marked, type Tokens } from "marked";

const HEADING_PREFIX: Record<number, string> = {
  1: "📌 ",
  2: "▎",
  3: "▸ ",
};

const INDEX_HEADERS = new Set(["#", "排名", "序号", "no", "no."]);

function isIndexColumn(header: string, values: string[]): boolean {
  if (INDEX_HEADERS.has(header.toLowerCase().trim())) return true;
  return values.length > 0 && values.every((v) => /^\d+$/.test(v.trim()));
}

function buildMarked(): Marked {
  const m = new Marked();

  m.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        const prefix = HEADING_PREFIX[depth] || "• ";
        return `\n${prefix}${text}\n`;
      },

      paragraph({ tokens }: Tokens.Paragraph) {
        return `${this.parser.parseInline(tokens)}\n\n`;
      },

      strong({ tokens }: Tokens.Strong) {
        return `<b>${this.parser.parseInline(tokens)}</b>`;
      },

      em({ tokens }: Tokens.Em) {
        return this.parser.parseInline(tokens);
      },

      del({ tokens }: Tokens.Del) {
        return this.parser.parseInline(tokens);
      },

      codespan({ text }: Tokens.Codespan) {
        return text;
      },

      code({ text }: Tokens.Code) {
        return `\n┈┈┈┈┈┈┈┈┈┈\n${text}\n┈┈┈┈┈┈┈┈┈┈\n`;
      },

      blockquote({ tokens }: Tokens.Blockquote) {
        const body = this.parser.parse(tokens).replace(/\n+$/, "");
        return body
          .split("\n")
          .map((l) => (l ? `│ ${l}` : "│"))
          .join("\n") + "\n";
      },

      list(token: Tokens.List) {
        let out = "";
        for (let i = 0; i < token.items.length; i++) {
          const item = token.items[i];
          const prefix = token.ordered ? `${token.start !== "" ? Number(token.start) + i : i + 1}. ` : "• ";
          const content = this.parser.parse(item.tokens).replace(/\n+$/, "");
          if (item.task) {
            const box = item.checked ? "☑" : "☐";
            out += `  ${box} ${content}\n`;
          } else {
            out += `  ${prefix}${content}\n`;
          }
        }
        return out + "\n";
      },

      listitem(item: Tokens.ListItem) {
        return this.parser.parse(item.tokens);
      },

      table(token: Tokens.Table) {
        const headers = token.header.map((cell) => this.parser.parseInline(cell.tokens));
        const rows = token.rows.map((row) =>
          row.map((cell) => this.parser.parseInline(cell.tokens)),
        );

        const idxCol = headers.findIndex((h, i) =>
          isIndexColumn(h, rows.map((r) => r[i] ?? "")),
        );

        const contentCols = headers
          .map((h, i) => ({ header: h, idx: i }))
          .filter((_, i) => i !== idxCol);

        let out = "";
        for (let r = 0; r < rows.length; r++) {
          const index = idxCol >= 0 ? rows[r][idxCol].trim() : String(r + 1);
          const titleCol = contentCols[0];
          const detailCols = contentCols.slice(1);

          if (contentCols.length === 1) {
            out += `${index}. ${rows[r][titleCol.idx]}\n`;
          } else if (contentCols.length === 2) {
            out += `${index}. ${rows[r][titleCol.idx]}\n`;
            out += `   ${rows[r][detailCols[0].idx]}\n`;
          } else {
            out += `${index}. ${rows[r][titleCol.idx]}\n`;
            for (const col of detailCols) {
              out += `   ${col.header}：${rows[r][col.idx] ?? ""}\n`;
            }
          }
          out += "\n";
        }
        return `\n${out}`;
      },

      tablerow({ text }: Tokens.TableRow) {
        return text as string;
      },

      tablecell(token: Tokens.TableCell) {
        return this.parser.parseInline(token.tokens);
      },

      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        if (!href || href === text) return text;
        return `<a href="${href}">${text}</a>`;
      },

      image({ text }: Tokens.Image) {
        return text ? `[图片: ${text}]` : "[图片]";
      },

      hr() {
        return "\n──────────\n";
      },

      br() {
        return "\n";
      },

      space() {
        return "";
      },

      html({ text }: Tokens.HTML | Tokens.Tag) {
        return text.replace(/<[^>]+>/g, "").trim();
      },

      text(token: Tokens.Text | Tokens.Escape) {
        if ("tokens" in token && token.tokens) {
          return this.parser.parseInline(token.tokens);
        }
        return token.text;
      },
    },
  });

  return m;
}

const wxMarked = buildMarked();

export function md2wx(markdown: string): string {
  const raw = wxMarked.parse(markdown) as string;
  return raw.replace(/\n{3,}/g, "\n\n").trim();
}
