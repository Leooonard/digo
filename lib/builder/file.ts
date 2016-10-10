/**
 * @fileOverview 文件
 * @author xuld <xuld@vip.qq.com>
 */
import { setProperty } from "../utility/object";
import { resolvePath, relativePath, getDir, changeDir, getExt, changeExt, inDir, pathEquals } from "../utility/path";
import { resolveUrl, relativeUrl } from "../utility/url";
import { stringToBuffer, bufferToString, base64Uri } from "../utility/encode";
import { readFileSync, existsFileSync, getStatSync } from "../utility/fsSync";
import { readFile, writeFile, copyFile, deleteFile, deleteParentDirIfEmpty } from "../utility/fs";
import { Pattern, Matcher } from "../utility/matcher";
import { SourceMapData, SourceMapObject, SourceMapBuilder, toSourceMapObject, toSourceMapBuilder, emitSourceMapUrl } from "../utility/sourceMap";
import { locationToIndex, indexToLocation, Location } from "../utility/location";
import { WriterOptions, Writer, SourceMapWriter, StreamOptions, BufferStream } from "./writer";
import { beginAsync, endAsync } from "./then";
import { LogEntry, LogLevel, format, getDisplayName, log } from "./logging";
import { cache, updateCache } from "./cache";
import { watcher } from "./watch";

/**
 * 表示一个文件。
 * @remark
 * 文件具体可以是物理文件或动态创建的文件。
 * 一个文件会被若干处理器处理，并在处理完成后一次性写入硬盘。
 */
export class File {

    // #region 初始化

    /**
     * 初始化新的文件。
     * @param srcPath 源路径。
     * @param path 目标路径。
     * @param data 数据。
     */
    constructor(srcPath?: string, path?: string, data?: string | Buffer) {
        this.srcPath = resolvePath(srcPath);
        this.path = path || this.srcPath;
        if (data != undefined) {
            this.data = data;
        }
    }

    /**
     * 提供直接查看当前文件对象的方法。
     */
    private inspect() {
        return "File " + this.toString();
    }

    /**
     * 获取当前文件的字符串形式。
     */
    toString() {
        return this.generated ?
            format("(Generated)") + getDisplayName(this.path) :
            getDisplayName(this.srcPath);
    }

    // #endregion

    // #region 路径

    /**
     * 获取当前文件的源路径。如果当前文件是生成的则返回空。
     */
    readonly srcPath: string;

    /**
     * 获取当前文件的目标路径。
     */
    get destPath() { return resolvePath(this.path); }

    /**
     * 获取或设置当前文件的路径。
     */
    path: string;

    /**
     * 获取当前文件的扩展名。
     */
    get ext() { return getExt(this.path); }

    /**
     * 设置当前文件的扩展名。
     */
    set ext(value) { this.path = changeExt(this.path, value); }

    /**
     * 获取当前文件的源文件夹。
     */
    get srcDir() { return getDir(this.srcPath); }

    /**
     * 获取当前文件的目标文件夹。
     */
    get destDir() { return getDir(this.path); }

    /**
     * 获取当前文件的最终文件夹。
     */
    get dir() { return getDir(this.srcPath); }

    /**
     * 设置当前文件的最终文件夹。
     */
    set dir(value) { this.path = changeDir(this.path, value); }

    /**
     * 判断当前文件是否是生成的。
     */
    get generated() { return !this.srcPath; }

    /**
     * 判断当前文件是否实际存在。
     */
    get exists() { return existsFileSync(this.srcPath); }

    // #endregion

    // #region 内容

    /**
     * 存储当前文件的源二进制内容。
     */
    private _srcBuffer: Buffer;

    /**
     * 获取当前文件的源二进制内容。
     */
    get srcBuffer() {
        if (this._srcBuffer == undefined) {
            if (this._srcContent == undefined) {
                if (this.srcPath && !(workingMode & WorkingMode.clean)) {
                    const taskId = beginAsync("Read: {file}", { file: this.toString() });
                    try {
                        this._srcBuffer = readFileSync(this.srcPath);
                    } finally {
                        endAsync(taskId);
                    }
                } else {
                    this._srcBuffer = Buffer.allocUnsafe(0);
                }
            } else {
                this._srcBuffer = stringToBuffer(this._srcContent, this.encoding);
            }
        }
        return this._srcBuffer;
    }

    /**
     * 存储当前文件的源文本内容。
     */
    private _srcContent: string;

    /**
     * 获取当前文件的源文本内容。
     */
    get srcContent() {
        if (this._srcContent == undefined) {
            if (this._srcBuffer == undefined) {
                if (this.srcPath && !(workingMode & WorkingMode.clean)) {
                    const taskId = beginAsync("Read: {file}", { file: this.toString() });
                    try {
                        this._srcContent = bufferToString(readFileSync(this.srcPath), this.encoding);
                    } finally {
                        endAsync(taskId);
                    }
                } else {
                    this._srcContent = "";
                }
            } else {
                this._srcContent = bufferToString(this._srcBuffer, this.encoding);
            }
        }
        return this._srcContent;
    }

    /**
     * 存储当前文件的目标二进制内容。
     */
    private _destBuffer: Buffer;

    /**
     * 获取当前文件的目标二进制内容。
     */
    get destBuffer() { return this.buffer; }

    /**
     * 存储当前文件的目标文本内容。
     */
    private _destContent: string;

    /**
     * 获取当前文件的目标文本内容。
     */
    get destContent() { return this.content; }

    /**
     * 获取当前文件的最终保存二进制内容。
     */
    get buffer() {
        if (this._destBuffer != undefined) {
            return this._destBuffer;
        }
        if (this._destContent != undefined) {
            return this._destBuffer = stringToBuffer(this._destContent, this.encoding);
        }
        return this.srcBuffer;
    }

    /**
     * 设置当前文件的最终保存二进制内容。
     */
    set buffer(value) {
        this._destBuffer = value;
        delete this._destContent;
        this.setModified();
    }

    /**
     * 获取当前文件的最终保存文本内容。
     */
    get content() {
        if (this._destContent != undefined) {
            return this._destContent;
        }
        if (this._destBuffer != undefined) {
            return this._destContent = bufferToString(this._destBuffer, this.encoding);
        }
        return this.srcContent;
    }

    /**
     * 设置当前文件的最终保存文本内容。
     */
    set content(value) {
        this._destContent = value;
        delete this._destBuffer;
        this.setModified();
    }

    /**
     * 获取当前文件的最终内容。
     */
    get data() { return this._destContent != undefined ? this._destContent : this.buffer; }

    /**
     * 设置当前文件的最终内容。
     */
    set data(value) {
        if (typeof value === "string") {
            this.content = value;
        } else {
            this.buffer = value;
        }
    }

    /**
     * 判断当前文件是否已修改。
     */
    get modified() { return this._destContent != undefined || this._destBuffer != undefined; }

    /**
     * 标记当前文件已被修改。
     */
    private setModified() {
        delete this.indexes;
    }

    /**
     * 获取读写当前文件使用的编码。
     */
    get encoding() { return encoding; }

    /**
     * 设置读写当前文件使用的编码。
     */
    set encoding(value) { setProperty(this, "encoding", value); }

    // #endregion

    // #region 行列号

    /**
     * 存储当前文件的每行第一个字符的索引值。
     */
    private indexes: number[];

    /**
     * 计算指定索引对应的行列号。
     * @param index 要检查的索引。
     * @returns 返回对应的行列号。
     */
    indexToLocation(index: number) {
        return indexToLocation(this.content, index, <any>this);
    }

    /**
     * 计算指定行列号对应的索引。
     * @param loc 要检查的行列号。
     * @returns 返回对应的索引。
     */
    locationToIndex(loc: Location) {
        return locationToIndex(this.content, loc, <any>this);
    }

    // #endregion

    // #region 源映射

    /**
     * 判断当前文件是否需要生成源映射。
     */
    get sourceMap() { return sourceMap; }

    /**
     * 设置当前文件是否需要生成源映射。
     */
    set sourceMap(value) { setProperty(this, "sourceMap", value); }

    /**
     * 获取当前文件的源映射保存路径。
     */
    get sourceMapPath() {
        if (sourceMapPath) {
            return sourceMapPath(this);
        }
    }

    /**
     * 设置当前文件的源映射保存路径。
     */
    set sourceMapPath(value) { setProperty(this, "sourceMapPath", value); }

    /**
     * 获取当前文件的源映射保存文件夹。
     */
    get sourceMapDir() { return getDir(this.sourceMapPath); }

    /**
     * 设置当前文件的源映射保存文件夹。
     */
    set sourceMapDir(value) { this.sourceMapPath = changeDir(this.sourceMapPath || this.path + ".map", value); }

    /**
     * 判断是否在源文件插入 #SourceMappingURL。
     */
    get sourceMapEmit() { return sourceMapEmit; }

    /**
     * 设置是否在源文件插入 #SourceMappingURL。
     */
    set sourceMapEmit(value) { setProperty(this, "sourceMapEmit", value); }

    /**
     * 判断是否内联源映射到源文件。
     * @remark 仅当 sourceMapEmit 为 true 时有效。
     */
    get sourceMapInline() { return sourceMapInline; }

    /**
     * 设置是否内联源映射到源文件。
     * @remark 仅当 sourceMapEmit 为 true 时有效。
     */
    set sourceMapInline(value) { setProperty(this, "sourceMapInline", value); }

    /**
     * 获取在源文件引用源映射的地址。
     * @remark 仅当 sourceMapEmit 为 true 时有效。
     */
    get sourceMapUrl() {
        if (sourceMapUrl) {
            return sourceMapUrl(this);
        }
    }

    /**
     * 设置在源文件引用源映射的地址。
     * @remark 仅当 sourceMapEmit 为 true 时有效。
     */
    set sourceMapUrl(value) { setProperty(this, "sourceMapInline", value); }

    /**
     * 获取或设置当前文件的源映射数据。
     */
    sourceMapData: SourceMapData;

    /**
     * 获取当前文件的源映射对象。
     */
    get sourceMapObject() {
        if (!this.sourceMapData) {
            return;
        }
        return this.sourceMapData = toSourceMapObject(this.sourceMapData);
    }

    /**
     * 获取当前文件的源映射字符串。
     */
    get sourceMapString() { return JSON.stringify(this.sourceMapObject); }

    /**
     * 判断是否在源映射插入 file 段。
     */
    get sourceMapIncludeFile() { return sourceMapIncludeFile; }

    /**
     * 设置是否在源映射插入 file 段。
     */
    set sourceMapIncludeFile(value) { setProperty(this, "sourceMapIncludeFile", value); }

    /**
     * 获取源映射中的 sourceRoot 内容。
     */
    get sourceMapRoot() { return sourceMapRoot; }

    /**
     * 设置源映射中的 sourceRoot 内容。
     */
    set sourceMapRoot(value) { setProperty(this, "sourceMapRoot", value); }

    /**
     * 判断是否在源映射插入 sourcesContent 段。
     */
    get sourceMapIncludeSourcesContent() { return sourceMapIncludeSourcesContent; }

    /**
     * 设置是否在源映射插入 sourcesContent 段。
     */
    set sourceMapIncludeSourcesContent(value) { setProperty(this, "sourceMapIncludeSourcesContent", value); }

    /**
     * 判断是否在源映射插入 names 段。
     */
    get sourceMapIncludeNames() { return sourceMapIncludeNames; }

    /**
     * 设置是否在源映射插入 names 段。
     */
    set sourceMapIncludeNames(value) { setProperty(this, "sourceMapIncludeNames", value); }

    /**
     * 获取当前文件的源映射构建器。
     */
    get sourceMapBuilder() {
        if (!this.sourceMapData) {
            return;
        }
        return this.sourceMapData = toSourceMapBuilder(this.sourceMapData);
    }

    /**
     * 应用指定的源映射。如果当前文件已经存在源映射则进行合并。
     * @param sourceMapData 要应用的源映射。
     */
    applySourceMap(sourceMapData: SourceMapData) {
        if (sourceMapData) {
            if (this.sourceMapData) {
                this.sourceMapBuilder.applySourceMap(toSourceMapBuilder(sourceMapData));
            } else {
                this.sourceMapData = sourceMapData;
            }
        }
        return this;
    }

    // #endregion

    // #region 读写

    /**
     * 异步载入当前文件内容。
     * @param callback 操作完成后的回调函数。
     */
    load(callback?: (error: NodeJS.ErrnoException, file: File) => void) {

        // 文件已载入。
        if (!this.srcPath || this._destContent != undefined || this._destBuffer != undefined || this._srcBuffer != undefined || this._srcContent != undefined || (workingMode & WorkingMode.clean)) {
            callback && callback(null, this);
            return this;
        }

        // 异步载入文件。
        const taskId = beginAsync("Read: {file}", { file: this.toString() });
        readFile(this.srcPath, (error, data) => {
            if (error) {
                this.error(error);
            } else {
                this._srcBuffer = data;
            }
            endAsync(taskId);
            callback && callback(error, this);
        });

        return this;

    }

    /**
     * 异步保存当前文件到指定路径。
     * @param dir 要保存的目标文件夹路径。如果为空则保存到当前文件夹。
     * @param callback 操作完成后的回调函数。
     */
    save(dir?: string, callback?: (error: NodeJS.ErrnoException, file: File, savePath: string) => void) {

        // 验证文件。
        const savePath = resolvePath(dir || ".", this.path);
        if (onValidateFile && !onValidateFile(savePath, this)) {
            callback && callback(null, this, savePath);
            return this;
        }

        // 检查是否覆盖源文件。
        const sourceMapEmit = this.sourceMapData && this.sourceMapEmit;
        const modified = this.modified || sourceMapEmit;
        if (pathEquals(this.srcPath, savePath)) {

            // 文件未修改，跳过保存。
            if (!modified) {
                callback && callback(null, this, savePath);
                return this;
            }

            // 不允许覆盖源文件。
            if (!this.overwrite) {
                const error = <NodeJS.ErrnoException>new Error("EEXIST, file already exists.");
                error.code = "EEXIST";
                error.errno = "17";
                this.error({
                    message: "Cannot overwrite source file. Use '--overwrite' to force saving.",
                    error: error
                });
                callback && callback(error, this, savePath);
                return this;
            }

        }

        // 保存完成后的回调。
        const args = { file: getDisplayName(savePath) };
        const sourceMapPath = this.sourceMapData && !this.sourceMapInline && (this.sourceMapPath || (savePath + ".map"));
        let pending = 1;
        const done = (error: NodeJS.ErrnoException) => {
            if (error) {
                this.error(error);
                if (--pending > 0) return;
            } else {
                if (--pending > 0) return;
                fileCount++;
                if (onSaveFile) {
                    onSaveFile(savePath, this);
                }
            }
            endAsync(taskId);
            callback && callback(error, this, savePath);
        };

        // 清理文件。
        if (workingMode & WorkingMode.clean) {
            var taskId = beginAsync("Clean: {file}", args);
            deleteFile(savePath, error => {
                if (error) {
                    return done(error);
                }
                deleteParentDirIfEmpty(savePath, done);
            });
            if (sourceMapPath) {
                pending++;
                deleteFile(sourceMapPath, error => {
                    if (error) {
                        return done(error);
                    }
                    deleteParentDirIfEmpty(sourceMapPath, done);
                });
            }
            return this;
        }

        // 预览文件。
        if (workingMode & WorkingMode.preview) {
            var taskId = beginAsync("Preview: {file}", args);
            done(null);
            return this;
        }

        // 生成文件。
        var taskId = beginAsync(modified ? "Save: {file}" : "Copy: {file}", args);

        // 生成源映射。
        if (this.sourceMapData) {

            // 生成最终的 sourceMap 数据。
            const sourceMapObject = toSourceMapObject(this.sourceMapData);
            const finalSourceMap: SourceMapObject = {
                version: sourceMapObject.version || 3,
                sources: sourceMapObject.sources || [],
                mappings: sourceMapObject.mappings || ""
            };

            // file。
            if (this.sourceMapIncludeFile) {
                finalSourceMap.file = relativeUrl(sourceMapPath, sourceMapObject.file || savePath);
            }

            // sourceRoot。
            const sourceRoot = this.sourceMapRoot || sourceMapObject.sourceRoot;
            if (sourceRoot) {
                finalSourceMap.sourceRoot = sourceRoot;
            }

            // sources。
            for (let i = 0; i < sourceMapObject.sources.length; i++) {
                finalSourceMap.sources[i] = sourceMapSource ?
                    sourceMapSource(sourceMapObject.sources[i], this) :
                    relativeUrl(sourceRoot || sourceMapPath, sourceMapObject.sources[i]);
            }

            // sourcesContent。
            if (this.sourceMapIncludeSourcesContent) {
                finalSourceMap.sourcesContent = [];
                for (let i = 0; i < sourceMapObject.sources.length; i++) {
                    finalSourceMap.sourcesContent[i] = sourceMapSourceContent ?
                        sourceMapSourceContent(sourceMapObject.sources[i], this) :
                        sourceMapObject.sourcesContent ?
                            sourceMapObject.sourcesContent[i] :
                            (sourceMapObject.sources[i] === this.srcPath ? this.srcContent : bufferToString(readFileSync(sourceMapObject.sources[i]), encoding));
                }
            }

            // names。
            if (this.sourceMapIncludeNames && sourceMapObject.names && sourceMapObject.names.length) {
                finalSourceMap.names = sourceMapObject.names;
            }

            // 验证源映射。
            var finalSourceMapString = onValidateSourceMap && onValidateSourceMap(finalSourceMap, this) || JSON.stringify(finalSourceMap);

            // 内联源映射。
            if (sourceMapEmit) {
                const sourceMapUrl = (this.sourceMapInline ? base64Uri("application/json", finalSourceMapString) : this.sourceMapUrl || relativeUrl(savePath, sourceMapPath));
            }

        }

        // 保存文件。
        const cb = (error: NodeJS.ErrnoException) => {
            if (error) {
                return done(error);
            }
            updateCache(this.srcPath, savePath);
            done(error);
        };
        if (modified) {
            writeFile(savePath, sourceMapEmit ? stringToBuffer(emitSourceMapUrl(this.content, this.sourceMapInline ? base64Uri("application/json", this.sourceMapString) : this.sourceMapUrl, /\.js$/i.test(this.path)), this.encoding) : this._destBuffer || stringToBuffer(this._destContent, this.encoding), cb);
        } else {
            copyFile(this.srcPath, savePath, cb);
        }

        // 保存源映射。
        if (!this.sourceMapInline && finalSourceMapString) {
            pending++;
            writeFile(sourceMapPath, stringToBuffer(finalSourceMapString, "utf-8"), (error: NodeJS.ErrnoException) => {
                if (error) {
                    return done(error);
                }
                updateCache(this.srcPath, sourceMapPath);
                done(error);
            });
        }

        return this;
    }

    /**
     * 删除当前源文件。
     * @param deleteDir 指示是否删除空的父文件夹。默认为 true。
     * @param callback 操作完成后的回调函数。
     */
    delete(deleteDir?: boolean, callback?: (error: NodeJS.ErrnoException, file: File) => void) {
        if (!this.srcPath) {
            callback && callback(null, this);
            return this;
        }
        const taskId = beginAsync("Delete: {file} ", { file: this.toString() });
        const done = (error: NodeJS.ErrnoException) => {
            if (error) {
                this.error(error);
            } else {
                fileCount++;
                if (onDeleteFile) {
                    onDeleteFile(this);
                }
            }
            endAsync(taskId);
            callback && callback(error, this);
        };
        deleteFile(this.srcPath, error => {
            if (error) {
                return done(error);
            }
            if (deleteDir !== false) {
                deleteParentDirIfEmpty(this.srcPath, done);
            } else {
                done(null);
            }
        });
        return this;
    }

    /**
     * 获取是否允许覆盖源文件。
     */
    get overwrite() { return overwrite; }

    /**
     * 设置是否允许覆盖源文件。
     */
    set overwrite(value) { setProperty(this, "overwrite", value); }

    // #endregion

    // #region 日志

    /**
     * 获取当前文件累积的错误数。
     */
    errorCount: number;

    /**
     * 获取当前文件累积的警告数。
     */
    warningCount: number;

    /**
     * 记录一条和当前文件相关的日志。
     * @param data 要记录的日志数据。
     * @param level 要记录的日志等级。
     */
    log(data: string | Error | FileLogEntry, level = LogLevel.log) {
        data = new FileLogEntry(this, data);
        if (onLogFile && onLogFile(data, level, this) === false) {
            return this;
        }

        switch (level) {
            case LogLevel.error:
            case LogLevel.fatal:
                this.errorCount = ++this.errorCount || 1;
                break;
            case LogLevel.warning:
                this.warningCount = ++this.warningCount || 1;
                break;
        }

        log(data, undefined, level);
        return this;
    }

    /**
     * 记录生成当前文件时出现的错误。
     * @param data 要记录的日志。
     */
    error(data?: string | Error | FileLogEntry) { return this.log(data, LogLevel.error); }

    /**
     * 记录生成当前文件时出现的警告。
     * @param data 要记录的日志。
     */
    warning(data?: string | Error | FileLogEntry) { return this.log(data, LogLevel.warning); }

    // #endregion

    // #region 依赖

    /**
     * 添加当前文件的依赖项。
     * @param path 相关的路径。
     * @param source 设置当前依赖的来源以方便调试。
     */
    dep(path: string | string[], source?: LogEntry) {
        if (!watcher) return;
        if (typeof path === "string") {
            watcher.addDep(this.srcPath, resolvePath(path), source);
        } else {
            for (const p of path) {
                this.dep(p, source);
            }
        }
    }

    /**
     * 添加当前文件的引用项。
     * @param path 相关的路径。
     * @param source 设置当前依赖的来源以方便调试。
     */
    ref(path: string | string[], source?: LogEntry) {
        if (!watcher) return;
        if (typeof path === "string") {
            watcher.addRef(this.srcPath, resolvePath(path), source);
        } else {
            for (const p of path) {
                this.ref(p, source);
            }
        }
    }

    // #endregion

    // #region 写入器

    /**
     * 创建一个文本写入器。
     * @param options 写入器的配置。
     */
    createWriter(options?: WriterOptions) {
        return (options && options.sourceMap != undefined ? options.sourceMap : this.sourceMap) ? new SourceMapWriter(this, options) : new Writer(this, options);
    }

    /**
     * 创建一个二进制写入流。
     * @param options 写入流的配置。
     */
    createStream(options?: StreamOptions) {
        return new BufferStream(this, options);
    }

    // #endregion

    // #region 工具

    /**
     * 获取当前文件的信息。
     */
    get stats() { return getStatSync(this.srcPath); }

    /**
     * 测试当前文件名是否匹配指定的匹配器。
     * @param matcher 要测试通配符、正则表达式、函数或以上的匹配器组成的数组。
     * @returns 如果匹配则返回 true，否则返回 false。
     */
    match(matcher: Pattern) { return new Matcher(matcher).test(this.path); }

    /**
     * 解析当前文件内的地址所表示的实际地址。
     * @param url 要解析的地址。如 `../a.js?a=1`。
     * @returns 返回解析好的绝对地址。
     */
    resolve(url: string) { return resolveUrl(this.srcPath, url); }

    /**
     * 获取在当前文件内引用指定地址或文件所使用的相对地址。
     * @param url 要解析的地址或文件。
     */
    relative(url: string | File) {
        return relativeUrl(this.path, url instanceof File ? url.path : url);
    }

    /**
     * 创建当前文件的副本。
     * @return 返回新文件对象。
     */
    clone() {
        return new File(this.srcPath, this.path, this.data);
    }

    // #endregion

}

/**
 * 表示工作模式。
 */
export const enum WorkingMode {

    /**
     * 生成。
     */
    build = 0,

    /**
     * 预览。
     */
    preview = 1 << 0,

    /**
     * 清理文件。
     */
    clean = 1 << 1,

    /**
     * 监听。
     */
    watch = 1 << 2,

}

/**
 * 获取当前工作模式。
 */
export var workingMode = WorkingMode.build;

/**
 * 获取或设置读写文件使用的默认编码。
 */
export var encoding = "utf-8";

/**
 * 获取或设置是否允许覆盖源文件。
 */
export var overwrite = false;

/**
 * 获取或设置是否启用源映射。
 */
export var sourceMap = true;

/**
 * 获取或设置用于计算每个文件的源映射路径的回调函数。
 * @param file 当前相关的文件。
 * @return 返回源映射的绝对路径。
 */
export var sourceMapPath: (file: File) => string = null;

/**
 * 获取或设置用于计算每个文件的源映射地址的回调函数。
 * @param file 当前相关的文件。
 * @return 返回源映射地址。
 */
export var sourceMapUrl: (file: File) => string = null;

/**
 * 获取或设置用于计算源映射中指定源文件地址的回调函数。
 * @param source 要计算的源文件地址。
 * @param file 当前相关的文件。
 * @return 返回对应的源文件地址。
 */
export var sourceMapSource: (source: string, file: File) => string = null;

/**
 * 获取或设置用于计算源映射中指定源文件内容的回调函数。
 * @param source 要计算的源文件地址。
 * @param file 当前相关的文件。
 * @return 返回对应的源文件内容。
 */
export var sourceMapSourceContent: (source: string, file: File) => string = null;

/**
 * 获取或设置是否在源文件中内联源映射。
 */
export var sourceMapInline = false;

/**
 * 获取或设置是否在源文件追加对源映射的引用注释。
 */
export var sourceMapEmit = true;

/**
 * 获取或设置源映射中引用源的跟地址。
 */
export var sourceMapRoot = "";

/**
 * 获取或设置是否在源映射插入 sourcesContent 段。
 */
export var sourceMapIncludeSourcesContent = false;

/**
 * 获取或设置是否在源映射插入 file 段。
 */
export var sourceMapIncludeFile = true;

/**
 * 获取或设置是否在源映射插入 names 段。
 */
export var sourceMapIncludeNames = true;

/**
 * 获取或设置生成文件源映射的回调函数。
 * @param sourceMap 当前的源映射对象。
 * @param file 当前相关的文件。
 */
export var onValidateSourceMap: (sourceMap: SourceMapObject, file: File) => string | void = null;

/**
 * 获取已处理的文件数。
 */
export var fileCount = 0;

/**
 * 获取或设置即将保存文件时的回调函数。
 * @param file 当前相关的文件。
 * @param savePath 要保存的绝对路径。
 * @returns 如果函数返回 false，则不保存此文件。
 */
export var onValidateFile: (savePath: string, file: File) => boolean = null;

/**
 * 获取或设置保存文件后的回调函数。
 * @param file 当前相关的文件。
 * @param savePath 已保存的绝对路径。
 */
export var onSaveFile: (savePath: string, file: File) => void = null;

/**
 * 获取或设置当删除文件后的回调函数。
 * @param file 当前相关的文件。
 */
export var onDeleteFile: (file: File) => void = null;

/**
 * 表示处理文件时产生的日志项。
 */
export class FileLogEntry extends LogEntry {

    /**
     * 是否允许执行源映射。
     */
    sourceMap?: boolean;

    /**
     * 源映射数据。
     */
    sourceMapData?: SourceMapData;

    /**
     * 初始化新的日志项。
     * @param data 要处理的日志数据。
     * @param args 格式化参数。日志信息中 `{x}` 会被替换为 `args.x` 的值。
     */
    constructor(file: File, data: string | Error | LogEntry, args?: Object) {
        super(data, args);

        // 从文件提取信息。
        if (file) {
            if (this.path == undefined) this.path = file.path;
            if (this.content == undefined) this.content = file.content;
            if (this.sourceMapData == undefined) this.sourceMapData = file.sourceMapData;
        }

        // 从源映射提取信息。
        if (this.sourceMap !== false && this.startLine != undefined && this.sourceMapData) {
            this.sourceMap = false;
            const builder = this.sourceMapData = toSourceMapBuilder(this.sourceMapData);
            const startSource = builder.getSource(this.startLine, this.startColumn || 0);
            if (!pathEquals(this.path, startSource.sourcePath)) {
                this.path = startSource.sourcePath;
                this.content = startSource.sourceContent;
            }
            this.startLine = startSource.line;
            this.startColumn = startSource.column;

            if (this.endLine != undefined) {
                const endSource = builder.getSource(this.endLine, this.endColumn || 0);
                if (pathEquals(this.path, endSource.sourcePath)) {
                    this.endLine = endSource.line;
                    this.endColumn = endSource.column;
                } else {
                    delete this.endLine;
                    delete this.endColumn;
                }
            }
        }

        // 提取文件内容。
        if (this.content == undefined && this.path != undefined && this.startLine != undefined) {
            this.content = new File(this.path).srcContent;
        }

    }

}

/**
 * 获取或设置文件产生日志时的回调。
 */
export var onLogFile: (data: FileLogEntry, level: LogEntry, file: File) => boolean | void = null;