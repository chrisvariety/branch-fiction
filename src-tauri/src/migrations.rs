use tauri_plugin_sql::{Migration, MigrationKind};

pub struct MainMigration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

pub const MAIN_MIGRATIONS: &[MainMigration] = &[
    MainMigration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/0001_init.sql"),
    },
    MainMigration {
        version: 2,
        description: "pipeline_steps",
        sql: include_str!("../migrations/0002_pipeline_steps.sql"),
    },
    MainMigration {
        version: 3,
        description: "plugins",
        sql: include_str!("../migrations/0003_plugins.sql"),
    },
    MainMigration {
        version: 4,
        description: "plugin_providers",
        sql: include_str!("../migrations/0004_plugin_providers.sql"),
    },
    MainMigration {
        version: 5,
        description: "pipeline_step_logs",
        sql: include_str!("../migrations/0005_pipeline_step_logs.sql"),
    },
    MainMigration {
        version: 6,
        description: "book_imports_notifications_enabled",
        sql: include_str!("../migrations/0006_book_imports_notifications_enabled.sql"),
    },
    MainMigration {
        version: 7,
        description: "provider_models_reasoning",
        sql: include_str!("../migrations/0007_provider_models_reasoning.sql"),
    },
    MainMigration {
        version: 8,
        description: "book_entity_extraction_checkpoints",
        sql: include_str!("../migrations/0008_book_entity_extraction_checkpoints.sql"),
    },
    MainMigration {
        version: 9,
        description: "pipeline_step_token_usage",
        sql: include_str!("../migrations/0009_pipeline_step_token_usage.sql"),
    },
    MainMigration {
        version: 10,
        description: "plugins_bundled",
        sql: include_str!("../migrations/0010_plugins_bundled.sql"),
    },
    MainMigration {
        version: 11,
        description: "plugins_provenance",
        sql: include_str!("../migrations/0011_plugins_provenance.sql"),
    },
    MainMigration {
        version: 12,
        description: "plugin_providers_override_base_url",
        sql: include_str!("../migrations/0012_plugin_providers_override_base_url.sql"),
    },
    MainMigration {
        version: 13,
        description: "plugin_dev_clients",
        sql: include_str!("../migrations/0013_plugin_dev_clients.sql"),
    },
    MainMigration {
        version: 14,
        description: "books_status",
        sql: include_str!("../migrations/0014_books_status.sql"),
    },
    MainMigration {
        version: 15,
        description: "book_imports_eta",
        sql: include_str!("../migrations/0015_book_imports_eta.sql"),
    },
    MainMigration {
        version: 16,
        description: "book_imports_cost",
        sql: include_str!("../migrations/0016_book_imports_cost.sql"),
    },
    MainMigration {
        version: 17,
        description: "pipeline_step_usages_reasoning",
        sql: include_str!("../migrations/0017_pipeline_step_usages_reasoning.sql"),
    },
    MainMigration {
        version: 18,
        description: "book_imports_auto_confirm_calibration",
        sql: include_str!("../migrations/0018_book_imports_auto_confirm_calibration.sql"),
    },
    MainMigration {
        version: 19,
        description: "providers_rpm_limit",
        sql: include_str!("../migrations/0019_providers_rpm_limit.sql"),
    },
    MainMigration {
        version: 20,
        description: "book_imports_projection_behavior",
        sql: include_str!("../migrations/0020_book_imports_projection_behavior.sql"),
    },
    MainMigration {
        version: 21,
        description: "book_imports_rename_auto_confirm",
        sql: include_str!("../migrations/0021_book_imports_rename_auto_confirm.sql"),
    },
    MainMigration {
        version: 22,
        description: "book_imports_text_model_bindings",
        sql: include_str!("../migrations/0022_book_imports_text_model_bindings.sql"),
    },
    MainMigration {
        version: 23,
        description: "rename_plugins_to_extensions",
        sql: include_str!("../migrations/0023_rename_plugins_to_extensions.sql"),
    },
    MainMigration {
        version: 24,
        description: "text_model_and_binding_model_key",
        sql: include_str!("../migrations/0024_text_model_and_binding_model_key.sql"),
    },
    MainMigration {
        version: 25,
        description: "book_imports_previous_in_series",
        sql: include_str!("../migrations/0025_book_imports_previous_in_series.sql"),
    },
    MainMigration {
        version: 26,
        description: "extensions_signed",
        sql: include_str!("../migrations/0026_extensions_signed.sql"),
    },
    MainMigration {
        version: 27,
        description: "book_seeds",
        sql: include_str!("../migrations/0027_book_seeds.sql"),
    },
];

pub fn tauri_plugin_migrations() -> Vec<Migration> {
    MAIN_MIGRATIONS
        .iter()
        .map(|m| Migration {
            version: m.version,
            description: m.description,
            sql: m.sql,
            kind: MigrationKind::Up,
        })
        .collect()
}
