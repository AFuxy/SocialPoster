/// Splits `text` into chunks fitting within `max_chars` (measured in Unicode scalar values).
/// When `add_numbering` is `true` and multiple chunks are needed, reserves space for ` (i/n)`
/// suffixes so every numbered chunk stays within `max_chars`.
pub fn split_into_thread(text: &str, max_chars: usize, add_numbering: bool) -> Vec<String> {
    if max_chars == 0 || text.chars().count() <= max_chars {
        return vec![text.to_string()];
    }

    if !add_numbering {
        return split_with_budget(text, max_chars);
    }

    // Converge on the suffix width ` (i/n)` so multi-digit thread counts never overflow `max_chars`.
    let mut estimated_total = (text.chars().count() / max_chars.max(1)) + 1;
    for _ in 0..5 {
        let max_suffix_len = format!(" ({estimated_total}/{estimated_total})")
            .chars()
            .count();
        let budget = max_chars.saturating_sub(max_suffix_len).max(1);
        let raw_chunks = split_with_budget(text, budget);
        let actual_total = raw_chunks.len();

        if actual_total <= 1 {
            return vec![text.to_string()];
        }

        let actual_max_suffix = format!(" ({actual_total}/{actual_total})").chars().count();
        if actual_max_suffix <= max_suffix_len || actual_total == estimated_total {
            return raw_chunks
                .into_iter()
                .enumerate()
                .map(|(idx, chunk)| format!("{chunk} ({}/{actual_total})", idx + 1))
                .collect();
        }
        estimated_total = actual_total;
    }

    let max_suffix_len = format!(" ({estimated_total}/{estimated_total})")
        .chars()
        .count();
    let budget = max_chars.saturating_sub(max_suffix_len).max(1);
    let raw_chunks = split_with_budget(text, budget);
    let total = raw_chunks.len();
    raw_chunks
        .into_iter()
        .enumerate()
        .map(|(idx, chunk)| format!("{chunk} ({}/{total})", idx + 1))
        .collect()
}

fn split_with_budget(text: &str, budget: usize) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut remaining = text.trim();

    while !remaining.is_empty() {
        if remaining.chars().count() <= budget {
            chunks.push(remaining.to_string());
            break;
        }

        let (split_at, next_start) = find_best_split(remaining, budget);
        let chunk = remaining[..split_at].trim_end();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }
        remaining = remaining[next_start..].trim_start();
    }

    if chunks.is_empty() {
        chunks.push(String::new());
    }
    chunks
}

/// Finds the highest-priority natural split index within `budget` characters:
/// 1. Paragraph break (`\n\n`)
/// 2. Sentence ending (`. `, `! `, `? `)
/// 3. Line break (`\n`)
/// 4. Word boundary (whitespace)
/// 5. Hard character boundary fallback
fn find_best_split(text: &str, budget: usize) -> (usize, usize) {
    let limit_byte = text
        .char_indices()
        .nth(budget)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len());
    let window = &text[..limit_byte];

    // 1. Paragraph break
    if let Some(pos) = window.rfind("\n\n")
        && pos > 0
    {
        return (pos, pos + 2);
    }

    // 2. Sentence ending (keep punctuation on the current chunk)
    let mut best_sentence: Option<(usize, usize)> = None;
    for marker in [". ", "! ", "? "] {
        if let Some(pos) = window.rfind(marker)
            && pos > 0
        {
            let end = pos + 1;
            if best_sentence.is_none_or(|(prev, _)| end > prev) {
                best_sentence = Some((end, pos + marker.len()));
            }
        }
    }
    if let Some(found) = best_sentence {
        return found;
    }

    // 3. Line break
    if let Some(pos) = window.rfind('\n')
        && pos > 0
    {
        return (pos, pos + 1);
    }

    // 4. Word boundary (whitespace)
    if let Some((pos, ch)) = window.char_indices().rfind(|(_, c)| c.is_whitespace())
        && pos > 0
    {
        return (pos, pos + ch.len_utf8());
    }

    // 5. Hard character boundary fallback for unbroken tokens (e.g. long URLs)
    (limit_byte, limit_byte)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_short_text_without_numbering() {
        let result = split_into_thread("Hello world", 280, true);
        assert_eq!(result, vec!["Hello world"]);
    }

    #[test]
    fn splits_at_paragraph_and_sentence_boundaries_within_budget() {
        let text = "First paragraph is short.\n\nSecond paragraph has two sentences. Here is the second sentence that pushes it over.";
        let chunks = split_into_thread(text, 65, true);
        assert!(chunks.len() >= 2);
        for (idx, chunk) in chunks.iter().enumerate() {
            assert!(
                chunk.chars().count() <= 65,
                "chunk {} exceeded 65 chars ({}): {}",
                idx,
                chunk.chars().count(),
                chunk
            );
            assert!(chunk.ends_with(&format!("({}/{})", idx + 1, chunks.len())));
        }
    }

    #[test]
    fn hard_splits_unbroken_long_url_with_suffix_budget() {
        let long_url = format!("https://example.com/{}", "a".repeat(120));
        let chunks = split_into_thread(&long_url, 50, true);
        assert!(chunks.len() >= 3);
        for chunk in &chunks {
            assert!(
                chunk.chars().count() <= 50,
                "chunk exceeded 50 chars: {}",
                chunk.chars().count()
            );
        }
    }
}
