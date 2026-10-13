// Writes files that hold secrets (vault key, vault data, MCP bridge token).

use std::io::Write;
use std::path::Path;

/// Writes `contents` to `path`, readable and writable by the current user
/// only. On Unix the file is created with mode 0600, so it is never briefly
/// readable by others. An existing file is tightened too, best-effort: some
/// filesystems (vfat, some FUSE/SMB mounts) reject chmod, and failing there
/// would break the vault and MCP bridge where they used to work. Windows'
/// default ACLs already restrict new files in the user's profile.
pub fn write(path: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(0o600);
        let mut file = options.open(path)?;
        let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
        file.write_all(contents.as_ref())
    }
    #[cfg(not(unix))]
    {
        options.open(path)?.write_all(contents.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_contents() {
        let path = std::env::temp_dir().join(format!("devtool-private-{}", uuid::Uuid::new_v4()));
        write(&path, "first").unwrap();
        write(&path, "2").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "2");
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn file_is_owner_only_even_if_it_existed() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("devtool-private-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, "x").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write(&path, "secret").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(&path);
    }
}
