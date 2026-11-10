import templatesJson from "../../config/reply-templates.json";

export type ReplyTemplateSlot = {
  name: string;
  description: string;
};

export type ReplyTemplate = {
  id: string;
  label: string;
  intent: string;
  when_to_use: string;
  body: string;
  slots: ReplyTemplateSlot[];
};

export type ReplyTemplatesConfig = {
  version: number;
  templates: ReplyTemplate[];
};

const config = templatesJson as ReplyTemplatesConfig;

export function listReplyTemplates(): ReplyTemplate[] {
  return config.templates;
}

export function getReplyTemplate(id: string): ReplyTemplate | undefined {
  return config.templates.find((t) => t.id === id);
}

/** Replace `{{slot}}` placeholders. Missing slots become empty string. */
export function renderTemplate(
  template: ReplyTemplate,
  slots: Record<string, string>,
): string {
  return template.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const value = slots[name];
    return value == null ? "" : value;
  });
}
