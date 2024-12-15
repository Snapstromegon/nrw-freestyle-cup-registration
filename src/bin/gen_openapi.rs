use std::fs;

use nrw_freestyle_cup_registration::http_server::routes::get_api_openapi;

fn main() {
    let doc = get_api_openapi();
    fs::write(
        "openapi.json",
        doc.to_pretty_json().expect("Couldn't generate json"),
    )
    .expect("Couldn't write to file");
}
