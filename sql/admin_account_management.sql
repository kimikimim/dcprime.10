-- 관리자 계정(이름/PIN) 조회·수정용 RPC
-- admin 테이블은 RLS로 직접 접근이 막혀있으므로, SECURITY DEFINER RPC로만 우회 접근

-- 목록 조회 (id, name, role만 — pin_hash는 노출 안 함)
CREATE OR REPLACE FUNCTION list_admin_accounts()
RETURNS TABLE(id text, name text, role text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT a.id::text, a.name, a.role FROM admin a ORDER BY
    CASE a.role WHEN '원장' THEN 0 WHEN '부원장' THEN 1 ELSE 2 END, a.name;
END;
$$;

-- 이름/PIN 수정 (p_pin이 NULL 또는 빈 문자열이면 기존 PIN 유지)
CREATE OR REPLACE FUNCTION update_admin_account(p_id text, p_name text, p_pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_pin IS NOT NULL AND p_pin <> '' THEN
    UPDATE admin SET name = p_name, pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
    WHERE id::text = p_id;
  ELSE
    UPDATE admin SET name = p_name WHERE id::text = p_id;
  END IF;
END;
$$;
