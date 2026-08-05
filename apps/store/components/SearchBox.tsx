"use client";

import type { SuggestResponse } from "@petrospecial/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Combobox, type ComboboxOption } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, t } from "@petrospecial/i18n";
import { publicGet } from "../lib/publicApi";

// EP-SF-006. The as-you-type half of SCR-SF02-001.
//
// Deliberately the only client component on /search: the results, the facets
// and the sort all live in the URL and are rendered on the server, so a
// filtered search is shareable, back-button-able and works with JavaScript
// still loading. This box only suggests — choosing a suggestion navigates,
// and typing a term the list does not contain submits it as a query.
export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [options, setOptions] = useState<ComboboxOption[]>([]);

  useEffect(() => {
    const term = query.trim();
    // The endpoint itself answers with nothing under two characters; not
    // asking at all saves a request per keystroke on the way there.
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      publicGet<SuggestResponse>(`/api/v1/catalog/suggest?q=${encodeURIComponent(term)}`, controller.signal)
        .then((res) =>
          setOptions(
            res.suggestions.map((suggestion) => ({
              value: suggestion.label,
              label: suggestion.label,
              description:
                suggestion.type === "family" ? t(locale, "search.suggestionFamily") : t(locale, "search.suggestionSku"),
              ...(suggestion.slug ? { meta: suggestion.slug } : {})
            }))
          )
        )
        // A suggestion list that fails to load is not worth a message: the
        // field still works, and Enter still searches.
        .catch(() => setOptions([]));
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [locale, query]);

  return (
    <Combobox
      label={t(locale, "search.label")}
      placeholder={t(locale, "search.placeholder")}
      hint={t(locale, "search.hint")}
      clearLabel={t(locale, "search.clear")}
      value={query}
      onChange={setQuery}
      options={options}
      status={t(locale, "search.suggestionsCount", { count: count(options.length) })}
      // A product suggestion goes straight to its datasheet; a family
      // suggestion has no page of its own, so it becomes a search for its
      // name — which is what the customer typed anyway.
      onSelect={(option) =>
        router.push(option.meta ? `/catalog/${option.meta}` : `/search?q=${encodeURIComponent(option.value)}`)
      }
      onSubmit={(value) => router.push(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : "/search")}
    />
  );
}
