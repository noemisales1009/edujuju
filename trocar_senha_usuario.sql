-- Função para um admin trocar a senha de outro usuário.
-- Rode este arquivo UMA VEZ no SQL Editor do Supabase.
-- SECURITY DEFINER: roda com privilégios do dono (postgres), podendo
-- atualizar auth.users, mas só executa se quem chama for admin ou super.

CREATE OR REPLACE FUNCTION trocar_senha_usuario(alvo uuid, nova_senha text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND access_level IN ('adm', 'super')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem trocar senhas.';
  END IF;

  IF nova_senha IS NULL OR length(trim(nova_senha)) < 6 THEN
    RAISE EXCEPTION 'A senha deve ter no mínimo 6 caracteres.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(nova_senha, extensions.gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = alvo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.';
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION trocar_senha_usuario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION trocar_senha_usuario(uuid, text) TO authenticated;
