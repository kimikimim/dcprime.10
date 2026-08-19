-- Storage(ten-uploads) 폴더(학생ID)와 학생 이름 매칭표
-- Supabase SQL Editor에서 실행 → 결과를 CSV로 export(우측 상단 Export)하면
-- 대시보드 Storage 화면에서 폴더(ID) 찾을 때 이름으로 대조 가능

SELECT
  split_part(o.name, '/', 1) AS student_id,
  s.name AS student_name,
  s.campus,
  count(*) AS photo_count,
  min(o.created_at) AS first_upload,
  max(o.created_at) AS last_upload
FROM storage.objects o
LEFT JOIN students s ON s.id::text = split_part(o.name, '/', 1)
WHERE o.bucket_id = 'ten-uploads'
GROUP BY 1, 2, 3
ORDER BY s.name;

-- ─────────────────────────────────────────────
-- 파일 단위로 전체 목록이 필요하면 이거 사용
-- SELECT
--   split_part(o.name, '/', 1) AS student_id,
--   s.name AS student_name,
--   o.name AS file_path,
--   o.created_at
-- FROM storage.objects o
-- LEFT JOIN students s ON s.id::text = split_part(o.name, '/', 1)
-- WHERE o.bucket_id = 'ten-uploads'
-- ORDER BY s.name, o.created_at;
