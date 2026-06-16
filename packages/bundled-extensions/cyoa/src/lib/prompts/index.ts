import { Template } from '@huggingface/jinja';
import * as v from 'valibot';

export type BaseSchema = v.GenericSchema<unknown, unknown, v.BaseIssue<unknown>>;

export type PromptMeta<Input extends BaseSchema> = {
  name: string;
  input: Input;
};

export type PromptTemplate<Input extends BaseSchema> = {
  name: string;
  render(input: v.InferInput<Input>): string;
};

export function createPrompt<Input extends BaseSchema>(
  meta: PromptMeta<Input>,
  prompt: string
): PromptTemplate<Input> {
  const template = new Template(prompt);
  return {
    name: meta.name,
    render(input: v.InferInput<Input>): string {
      const parsed = v.parse(meta.input, input);
      return template.render(parsed as Record<string, unknown>);
    }
  };
}
