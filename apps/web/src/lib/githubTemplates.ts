/**
 * Curated .gitignore + license template lists for the New Repository page. These are the names GitHub's
 * create API accepts (`gitignore_template` uses the github/gitignore repo names; `license_template` uses
 * license keywords). A hand-picked subset keeps the pickers short and avoids an extra GitHub API call
 * (which the sandbox proxy blocks anyway).
 */

export interface TemplateOption {
  value: string;
  label: string;
}

/** github/gitignore template names (case-sensitive as the API expects them). */
export const GITIGNORE_TEMPLATES: TemplateOption[] = [
  { value: "", label: "None" },
  { value: "Node", label: "Node" },
  { value: "Python", label: "Python" },
  { value: "Go", label: "Go" },
  { value: "Rust", label: "Rust" },
  { value: "Java", label: "Java" },
  { value: "VisualStudio", label: "Visual Studio (.NET)" },
  { value: "Ruby", label: "Ruby" },
  { value: "Swift", label: "Swift" },
  { value: "Kotlin", label: "Kotlin" },
  { value: "C++", label: "C++" },
  { value: "C", label: "C" },
  { value: "Elixir", label: "Elixir" },
  { value: "Laravel", label: "PHP (Laravel)" },
  { value: "Android", label: "Android" },
  { value: "Unity", label: "Unity" },
];

/** GitHub license keywords accepted by `license_template`. */
export const LICENSE_TEMPLATES: TemplateOption[] = [
  { value: "", label: "None" },
  { value: "mit", label: "MIT" },
  { value: "apache-2.0", label: "Apache 2.0" },
  { value: "gpl-3.0", label: "GNU GPLv3" },
  { value: "agpl-3.0", label: "GNU AGPLv3" },
  { value: "lgpl-3.0", label: "GNU LGPLv3" },
  { value: "mpl-2.0", label: "Mozilla Public License 2.0" },
  { value: "bsd-2-clause", label: "BSD 2-Clause" },
  { value: "bsd-3-clause", label: "BSD 3-Clause" },
  { value: "unlicense", label: "The Unlicense" },
  { value: "cc0-1.0", label: "Creative Commons Zero v1.0" },
];
