/* eslint-disable */
/**
 * This file was automatically generated from Product Content v1.
 * DO NOT MODIFY IT BY HAND. Run `npm run generate` in contracts/product-content.
 */

export type Title = string;
export type ShortText = string;
export type LinkUrl = string;
export type ImageUrl = string;
export type LongText = string;

export interface SoverisProductContentV1DraftSafeDocument {
  slug: string;
  name: string;
  hero: Hero;
  features?: Features;
  questions?: Questions;
  form?: Form;
  /**
   * @minItems 1
   * @maxItems 4
   */
  footer?:
    | [FooterSection]
    | [FooterSection, FooterSection]
    | [FooterSection, FooterSection, FooterSection]
    | [FooterSection, FooterSection, FooterSection, FooterSection];
  seo?: Seo;
}
export interface Hero {
  title: Title;
  subtitle: ShortText;
  cta: Link;
  secondaryCta?: Link;
  backgroundImage: Image;
  trustText?: ShortText;
}
export interface Link {
  label: Title;
  href: LinkUrl;
}
export interface Image {
  src: ImageUrl;
  alt: Title;
}
export interface Features {
  heading: Title;
  description?: ShortText;
  /**
   * @minItems 1
   * @maxItems 12
   */
  items:
    | [Feature]
    | [Feature, Feature]
    | [Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature]
    | [Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature, Feature];
}
export interface Feature {
  title: Title;
  description: ShortText;
  image?: Image;
}
export interface Questions {
  heading: Title;
  description?: ShortText;
  /**
   * @minItems 1
   * @maxItems 20
   */
  items:
    | [Question]
    | [Question, Question]
    | [Question, Question, Question]
    | [Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question, Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question, Question, Question, Question, Question, Question]
    | [Question, Question, Question, Question, Question, Question, Question, Question, Question, Question, Question]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ]
    | [
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
        Question,
      ];
}
export interface Question {
  question: Title;
  answer: LongText;
}
export interface Form {
  title: Title;
  description?: ShortText;
  submitLabel: Title;
  schema: SoverisProductContentV1SupportedFormProfile;
}
export interface SoverisProductContentV1SupportedFormProfile {
  type: "object";
  properties: {
    [k: string]: Text | Email | Textarea | Select | Radio | Checkbox;
  };
  /**
   * @maxItems 20
   */
  required?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
  additionalProperties: false;
}
export interface Text {
  type: "string";
  title: string;
  order: number;
  minLength?: number;
  maxLength: number;
}
export interface Email {
  type: "string";
  format: "email";
  title: string;
  order: number;
  minLength?: number;
  maxLength: number;
}
export interface Textarea {
  type: "string";
  "ui:widget": "textarea";
  title: string;
  order: number;
  minLength?: number;
  maxLength: number;
}
export interface Select {
  type: "string";
  title: string;
  order: number;
  /**
   * @minItems 1
   * @maxItems 20
   */
  enum:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
  "ui:enumLabels"?: EnumLabels;
}
export interface EnumLabels {
  [k: string]: string;
}
export interface Radio {
  type: "string";
  "ui:widget": "radio";
  title: string;
  order: number;
  /**
   * @minItems 1
   * @maxItems 20
   */
  enum:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
  "ui:enumLabels"?: EnumLabels;
}
export interface Checkbox {
  type: "array";
  "ui:widget": "checkbox";
  title: string;
  order: number;
  items: {
    type: "string";
    /**
     * @minItems 1
     * @maxItems 20
     */
    enum:
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ];
  };
  uniqueItems: true;
  minItems?: number;
  maxItems: number;
  "ui:enumLabels"?: EnumLabels;
  "ui:exclusionGroups"?: ExclusionGroups;
}
export interface ExclusionGroups {
  /**
   * @minItems 1
   * @maxItems 20
   */
  [k: string]:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
}
export interface FooterSection {
  heading: Title;
  /**
   * @minItems 1
   * @maxItems 8
   */
  links:
    | [FooterLink]
    | [FooterLink, FooterLink]
    | [FooterLink, FooterLink, FooterLink]
    | [FooterLink, FooterLink, FooterLink, FooterLink]
    | [FooterLink, FooterLink, FooterLink, FooterLink, FooterLink]
    | [FooterLink, FooterLink, FooterLink, FooterLink, FooterLink, FooterLink]
    | [FooterLink, FooterLink, FooterLink, FooterLink, FooterLink, FooterLink, FooterLink]
    | [FooterLink, FooterLink, FooterLink, FooterLink, FooterLink, FooterLink, FooterLink, FooterLink];
}
export interface FooterLink {
  name: Title;
  href: LinkUrl;
}
export interface Seo {
  metaTitle?: string;
  metaDescription?: string;
}
