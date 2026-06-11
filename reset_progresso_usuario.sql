-- Função para zerar o progresso de um usuário (respostas + progresso_usuario).
-- Rode este arquivo UMA VEZ no SQL Editor do Supabase.
-- SECURITY DEFINER: roda com privilégios do dono, contornando o RLS,
-- mas só executa se quem chama for admin ou super admin.

CREATE OR REPLACE FUNCTION reset_progresso_usuario(alvo uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_respostas int;
  n_progresso int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND access_level IN ('adm', 'super')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem zerar progresso.';
  END IF;

  DELETE FROM respostas WHERE user_id = alvo;
  GET DIAGNOSTICS n_respostas = ROW_COUNT;

  DELETE FROM progresso_usuario WHERE user_id = alvo;
  GET DIAGNOSTICS n_progresso = ROW_COUNT;

  RETURN json_build_object('respostas', n_respostas, 'progresso', n_progresso);
END;
$$;

REVOKE EXECUTE ON FUNCTION reset_progresso_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reset_progresso_usuario(uuid) TO authenticated;
