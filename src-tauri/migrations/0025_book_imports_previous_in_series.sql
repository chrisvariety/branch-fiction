ALTER TABLE book_imports ADD COLUMN previous_in_series_book_id text REFERENCES books(id) ON DELETE SET NULL;
