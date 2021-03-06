/**
 * @fileOverview 插件
 * @author xuld <xuld@vip.qq.com>
 */
import { resolvePath } from "../utility/path";
import { begin, end } from "./progress";

/**
 * 存储所有已载入的插件对象。
 */
const plugins: { [name: string]: any } = { __proto__: null };

/**
 * 尝试载入指定的插件。
 * @param name 要载入的插件名。
 * @returns 返回插件导出对象。
 */
export function plugin(name: string) {
    const loaded = plugins[name];
    if (loaded) {
        return loaded;
    }
    const taskId = begin("Load plugin: {plugin}", { plugin: name });
    const isRelative = /^[\.\/\\]|^\w+\:/.test(name);

    try {
        name = require.resolve(resolvePath(isRelative ? "." : "node_modules", name));
    } catch (e) {
        try {
            name = require.resolve(name);
        } catch (e) {
            end(taskId);
            throw new Error(isRelative ? `Cannot find plugin '${name}'.` : `Cannot find plugin '${name}'. Use 'npm install ${name}' to install it.`);
        }
    }

    try {
        return plugins[name] = require(name);
    } finally {
        end(taskId);
    }

}
