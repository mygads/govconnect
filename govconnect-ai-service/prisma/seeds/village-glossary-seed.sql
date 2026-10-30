-- A2 example seeds: common Javanese/Sundanese terms for complaint intake.
--
-- OPTIONAL. Run manually per village (replace <village_id>):
--
--   psql "$DATABASE_URL" -v village="'<village_id>'" -f village-glossary-seed.sql
--
-- Villages add their own terms any time:
--   INSERT INTO pipeline_village_glossaries (id, village_id, istilah, bentuk_baku, contoh)
--   VALUES (gen_random_uuid()::text, '<village_id>', 'dalane', 'jalannya', 'dalane rusak');
-- (Dashboard UI for glossary management is future work.)

INSERT INTO pipeline_village_glossaries (id, village_id, istilah, bentuk_baku, contoh)
VALUES
  (gen_random_uuid()::text, :village, 'dalane', 'jalannya', 'dalane rusak → jalannya rusak'),
  (gen_random_uuid()::text, :village, 'dalan', 'jalan', 'dalan rusak → jalan rusak'),
  (gen_random_uuid()::text, :village, 'bade', 'mau', 'bade ngadamel KTP → mau membuat KTP'),
  (gen_random_uuid()::text, :village, 'ngadamel', 'membuat', 'ngadamel KTP → membuat KTP'),
  (gen_random_uuid()::text, :village, 'piye', 'bagaimana', 'piye carane → bagaimana caranya'),
  (gen_random_uuid()::text, :village, 'suwun', 'terima kasih', 'matur suwun → terima kasih'),
  (gen_random_uuid()::text, :village, 'lurah-e', 'lurahnya', 'lurah-e sopo → lurahnya siapa'),
  (gen_random_uuid()::text, :village, 'kumaha', 'bagaimana', 'kumaha carana → bagaimana caranya'),
  (gen_random_uuid()::text, :village, 'hatur nuhun', 'terima kasih', 'hatur nuhun → terima kasih')
ON CONFLICT (village_id, istilah) DO NOTHING;
