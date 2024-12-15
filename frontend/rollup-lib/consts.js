export default function consts(data, { magicProtocol = "consts" } = {}) {
  return {
    name: "consts",
    resolveId(id) {
      const protocol = id.split(":").shift();
      if (protocol === magicProtocol) {
        return id;
      }
      return null;
    },
    async load(id) {
      const i = id.indexOf(":");
      const [protocol, key] = [id.slice(0, i), id.slice(i + 1)];
      if (protocol === magicProtocol) {
        let wantedData = data[key];
        if (wantedData === undefined) {
          throw new Error(`No data found for key ${key}`);
        }
        if (wantedData instanceof Promise) {
          wantedData = await wantedData;
        }
        if (wantedData instanceof Function) {
          wantedData = await wantedData();
        }
        return `export default ${JSON.stringify(wantedData)};`;
      }
      return null;
    },
  };
}
