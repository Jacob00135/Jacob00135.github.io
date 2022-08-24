(function (window, document) {
    let db = null;
    const maxRecord = 10;  // 每个级别最多显示多少条记录
    connectDatabase();

    // 连接数据库，并创建一个排行榜表
    function connectDatabase (callback) {
        if (db === null) {
            const request = indexedDB.open('Minesweeper', 1);
            request.addEventListener('upgradeneeded', function (e) {
                db = request.result;
                if (!db.objectStoreNames.contains('rankList')) {
                    const objectStore = db.createObjectStore('rankList', {autoIncrement: true, keyPath: 'id'});
                    objectStore.createIndex('level', 'level');
                }
            });
            request.addEventListener('success', function (e) {
                db = request.result;
                callback && callback();
            });
        } else {
            callback && callback();
        }
    }

    // 向排行榜表中添加一条数据
    function insertRecord (level, insertTime, gameTime) {
        connectDatabase(function () {
            // 获取表对象
            const rankList = db.transaction(['rankList'], 'readwrite').objectStore('rankList');

            // 读取指定等级的数据
            const readRequest = rankList.index('level').getAll(level);
            readRequest.addEventListener('success', function (e) {
                const result = readRequest.result;

                // 检查是否这个级别的记录是否已满，若已满，则检查是否插入新记录
                let insert = true;
                if (result.length >= maxRecord) {
                    let maxGameTime = gameTime;
                    let maxRecordId = -1;
                    result.forEach((record, i) => {
                        if (maxGameTime < record['gameTime']) {
                            maxGameTime = record['gameTime'];
                            maxRecordId = record['id'];
                        }
                    });

                    // 是不插入新纪录，还是插入新纪录并删除游戏时间最长的记录
                    if (maxRecordId === -1) {
                        insert = false;
                    } else {
                        rankList.delete(maxRecordId);
                    }
                }

                // 插入记录
                if (insert) {
                    rankList.add({level: level, insertTime: insertTime, gameTime: gameTime});
                }
            });
        });
    }

    // 读取排行榜数据
    function readRecord (callback) {
        connectDatabase(function () {
            const request = db.transaction(['rankList']).objectStore('rankList').getAll();
            request.addEventListener('success', function () {
                callback && callback(request.result);
            });
        });
    }

    // 方块类
    class Block {
        static minButtonSize = 25;
        static maxButtonSize = 46;
        static gameArea; // 每次游戏的游戏区域
        static render; // Render实例
        static numberClass = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

        row; // 所在行
        col; // 所在列
        num; // -2表示边界，-1表示雷，0表示无数字方块，1-8表示数字方块
        #status = 0; // 0表示未翻开，1表示翻开
        round = []; // 周围的方块，以列表形式保存，列表中的元素是Block的实例
        button; // 对应的html元素节点
        #flag = false; // false表示没有插旗，true表示插旗

        constructor (row, col, num) {
            this.row = row;
            this.col = col;
            this.num = num;

            // 生成button
            this.button = document.createElement('button');
            this.button.type = 'button';
            this.button.className = 'btn btn-default';
            this.button.blockObject = this;
            this.button.addEventListener('click', this.clickEventListener);
            this.button.addEventListener('mousedown', this.rightClickEventListener);
            this.button.addEventListener('mouseup', this.leftRightClickEventListener);
            this.button.clickLeftTime = 0;
            this.button.clickRightTime = 0;
        }

        countRoundMine () {
            // 计算该方块周围的雷数，并设置为num
            if (this.num === -1) return;
            this.num = 0;
            for (let i = 0; i < this.round.length; i++) {
                if (this.round[i].num === -1) {
                    this.num = this.num + 1
                }
            }
        }

        open () {
            if (this.status === 1) {
                return;
            }

            // 如果是新开游戏的第一次翻开方块，则初始化雷和数字
            if (Block.gameArea.firstOpen) {
                Block.gameArea.firstOpen = false;
                Block.gameArea.generateMine(this);
                Block.gameArea.generateNumber();
                Render.startTimer();
            }

            // 若翻开空白块（即0数字方块），触发翻开其他数字块的连续操作，使用队列来操作
            const queue = [];
            if (this.status === 0 && this.num === 0) {
                queue.unshift(this);
            }
            this.status = 1;
            while (queue.length > 0) {
                let centerBlock = queue.pop();
                for (let i = 0; i < centerBlock.round.length; i++) {
                    let block = centerBlock.round[i];
                    if (block.status === 0 && block.num === 0) queue.unshift(block);
                    block.flag = false;
                    block.status = 1;
                }
            }

            // 判断是否赢了
            if (Block.gameArea.isWin()) {
                Block.render.showGameOverModal(true);
            }
        }

        clickEventListener (e) {
            this.blockObject.open();
        }

        rightClickEventListener (e) {
            if (e.button !== 2) return;
            if (Block.gameArea.firstOpen) this.click();
            this.blockObject.flag = !this.blockObject.flag;
        }

        leftRightClickEventListener (e) {
            // 每次松开左键或右键，都会记录松开的时间，若左键和右键松开的时间之差小于0.1秒，则判定为双键同时按，触发双键翻开操作
            if (e.button === 0) {
                this.clickLeftTime = Date.now();
            } else if (e.button === 2) {
                this.clickRightTime = Date.now();
            }
            if (Math.abs(this.clickRightTime - this.clickLeftTime) < 100 && 0 < this.blockObject.num && this.blockObject.num <= 8) {
                // 检测被点击的方块的周围方块被标旗的数量是否等于被点击方块的数字
                let flagCount = 0;
                for (let i = 0; i < this.blockObject.round.length; i++) {
                    if (this.blockObject.round[i].flag) flagCount = flagCount + 1;
                }
                if (flagCount !== this.blockObject.num) return;
                
                // 执行双键翻开操作：依次点开周围中满足三个条件1.不在边界2.没有标雷3.没有翻开的方块
                for (let i = 0; i < this.blockObject.round.length; i++) {
                    let b = this.blockObject.round[i];
                    if (0 < b.row && b.row < Block.gameArea.rows - 1 && 0 < b.col && b.col < Block.gameArea.cols - 1 && b.status === 0 && !b.flag) {
                        b.button.click();
                    }
                }
            }
        }

        get status () {
            return this.#status;
        }

        set status (value) {
            if (this.flag) return;
            this.#status = value;
            if (value === 1) {
                this.button.classList.add('open');
                if (0 < this.num && this.num <= 8) {
                    this.button.innerHTML = this.num;
                    this.button.classList.add(Block.numberClass[this.num - 1]);
                } else if (this.num === -1) {
                    // 判断是否踩雷
                    this.button.classList.add('glyphicon');
                    this.button.classList.add('glyphicon-remove');
                    this.button.classList.add('mine');
                    Block.render.showGameOverModal(false);
                    Block.render.showAllMineBlock();
                }
            }
        }

        get flag () {
            return this.#flag;
        }

        set flag (value) {
            if (this.status === 1) return;
            this.#flag = value;
            if (value) {
                this.button.classList.add('glyphicon');
                this.button.classList.add('glyphicon-flag');
            } else {
                this.button.classList.remove('glyphicon');
                this.button.classList.remove('glyphicon-flag');
            }

            // 计算剩余雷数
            let leftMineCount = Block.gameArea.mineCount;
            for (let r = 1; r <= Block.gameArea.rows - 2; r++) {
                for (let c = 1; c <= Block.gameArea.cols - 2; c++) {
                    if (Block.gameArea.blockArray[r][c].flag) {
                        leftMineCount = leftMineCount - 1;
                    }
                }
            }
            Render.leftMineCount.innerHTML = leftMineCount;
        }
    }

    // 游戏区域
    class GameArea {
        static level = 0; // 0表示初级9 × 9 × 10，1表示中级16 × 16 × 40，2表示高级16 × 30 × 99
        static levelMapping = {
            0: {'rows': 11, 'cols': 11, 'mineCount': 10},
            1: {'rows': 18, 'cols': 18, 'mineCount': 40},
            2: {'rows': 18, 'cols': 32, 'mineCount': 99}
        };
        rows; // 区域的行数量
        cols; // 区域的列数量
        mineCount; // 雷的数量
        blockArray; // 保存了每个方块的数组，形状是二维[rows, cols]
        buttonElementArray; // 保存了每一个button元素的数组，形状是二维[rows - 2, cols - 2]
        firstOpen = true; // 是否是第一次翻开方块，用于让第一次翻开的方块永远是0方块
        restartGame = false; // 标记当前的游戏是否为重开的与上一局相同布局的游戏，若是，则不计入排行榜

        constructor (rows, cols, mineCount) {
            if ((rows - 2) * (cols - 2) < mineCount) throw '雷数不能大于方块数！';
            // 初始化属性
            this.rows = rows;
            this.cols = cols;
            this.mineCount = mineCount;

            // 生成方块，初始值全是-2
            this.blockArray = generateBlockArray(this.rows, this.cols, -2);

            // 初始化方块数组中的每一个Block实例的round属性
            this.initRound();

            // 不在此处初始化雷和数字方块，需要等到第一次翻开方块的时候才初始化雷和数字，因为要保证玩家点击的第一个方块永远是0方块

            // 初始化工作完毕后，为Block类设置静态的gameArea
            Block.gameArea = this;
        }

        initRound () {
            // 初始化一个blockArray中的所有Block实例的round属性
            for (let r = 1; r <= this.rows - 2; r++) {
                for (let c = 1; c <= this.cols - 2; c++) {
                    let block = this.blockArray[r][c];
                    for (let rAdd = -1; rAdd <= 1; rAdd++) {
                        for (let cAdd = -1; cAdd <= 1; cAdd++) {
                            if (rAdd === 0 && cAdd === 0) continue;
                            block.round.push(this.blockArray[block.row + rAdd][block.col + cAdd]);
                        }
                    }
                }
            }
        }

        generateMine (excludeBlock) {
            // 排除第一次点开的方块以及其周围的块，使这9个方块不可能会是雷
            const indexArray = generateRangeArray(0, (this.rows - 2) * (this.cols - 2));
            const centerIndex = (excludeBlock.row - 1) * (this.cols - 2) + excludeBlock.col - 1;
            let excludeCenter = false;
            for (let i = excludeBlock.round.length - 1; i >= 0; i--) {
                let b = excludeBlock.round[i];
                if (0 < b.row && b.row < this.rows - 1 && 0 < b.col && b.col < this.cols - 1) {
                    let index = (b.row - 1) * (this.cols - 2) + b.col - 1;
                    if (index < centerIndex && !excludeCenter) {
                        indexArray.splice(centerIndex, 1);
                        excludeCenter = true;
                    }
                    indexArray.splice(index, 1);
                }
            }
            if (!excludeCenter) {
                indexArray.splice(centerIndex, 1);
            }

            // 随机生成雷，并赋予Block实例
            const mineIndexArray = choiceValue(indexArray, this.mineCount);
            for (let i = 0; i < mineIndexArray.length; i++) {
                let mineIndex = mineIndexArray[i];
                let r = parseInt(mineIndex / (this.cols - 2)) + 1;
                let c = (mineIndex % (this.cols - 2)) + 1;
                this.blockArray[r][c].num = -1;
            }
        }

        generateNumber () {
            for (let r = 1; r <= this.rows - 2; r++) {
                for (let c = 1; c <= this.cols - 2; c++) {
                    this.blockArray[r][c].countRoundMine();
                }
            }
        }

        isWin () {
            for (let r = 1; r <= this.rows - 2; r++) {
                for (let c = 1; c <= this.cols - 2; c++) {
                    let block = this.blockArray[r][c];
                    if (block.num !== -1 && block.status === 0) {
                        return false;
                    }
                }
            }
            return true;
        }
    }

    // 生成HTML
    class Render {
        static mainBox = document.getElementById('main');
        static gameTime = document.getElementById('game-time');
        static restartButton = document.getElementById('restart');
        static startNewGameButton = document.getElementById('start-new-game');
        static levelButtonArray = document.querySelectorAll('#action-btn-group .level button[data-level]');
        static blockArea = document.getElementById('block-area');
        static gameOverModal = document.getElementById('game-over');
        static leftMineCount = document.querySelector('#action-btn-group .left-mine-count .number');
        static rankListModal = document.getElementById('rank-list');
        static rankTbodyArray = document.querySelectorAll('#rank-list table > tbody');

        gameArea;

        constructor (gameArea) {
            this.gameArea = gameArea;
        }

        initGame () {
            Block.render = this;
            Render.gameTime.innerHTML = '00:00:00';
            Render.stopTimer();
            Render.leftMineCount.innerHTML = this.gameArea.mineCount;
            this.generateBlockArea();
            Render.setMainBoxSize();
        }

        generateBlockArea () {
            const table = document.createElement('table');
            for (let r = 1; r <= this.gameArea.rows - 2; r++) {
                let tr = document.createElement('tr');
                for (let c = 1; c <= this.gameArea.cols - 2; c++) {
                    let td = document.createElement('td');
                    // this.gameArea.blockArray[r][c].button.innerHTML = (r - 1) * (this.gameArea.cols - 2) + c - 1; // 测试用
                    td.appendChild(this.gameArea.blockArray[r][c].button);
                    tr.appendChild(td);
                }
                table.appendChild(tr);
            }
            Render.blockArea.appendChild(table);
        }

        static setMainBoxSize () {
            // 计算需要适应宽度的按钮的大小，并通过改变html的字体大小，再间接通过rem单位改变按钮的大小
            const totalWidth = window.innerWidth - 40;
            const borderWidthSum = Block.gameArea.cols - 1;
            const cols = Block.gameArea.cols - 2;
            let htmlFontSize = parseInt((totalWidth - borderWidthSum) / cols);
            if (htmlFontSize < Block.minButtonSize) {
                htmlFontSize = Block.minButtonSize;
            } else if (htmlFontSize > Block.maxButtonSize) {
                htmlFontSize = Block.maxButtonSize;
            }
            document.documentElement.style.fontSize = htmlFontSize + 'px';

            // 让mainBox的宽度适应方块区域的宽度
            setTimeout(function () {
                Render.mainBox.style.width = (Render.blockArea.querySelector('table').offsetWidth + 30) + 'px';
            }, 200);
        }

        showAllMineBlock () {
            // 显示所有的雷的位置，把所有标错非雷块的旗子改成“×”标记
            for (let r = 1; r <= this.gameArea.rows - 2; r++) {
                for (let c = 1; c <= this.gameArea.cols - 2; c++) {
                    let block = this.gameArea.blockArray[r][c];
                    if (block.num === -1) {
                        block.button.classList.add('glyphicon');
                        block.button.classList.add('glyphicon-remove');
                        block.button.classList.add('mine');
                    } else if (block.flag) {
                        block.button.classList.remove('glyphicon-flag');
                        block.button.classList.add('glyphicon-remove-circle');
                    }
                }
            }
        }

        showGameOverModal (win) {
            // 停止计时器，并且获取游戏用时
            const gameTime = Render.stopTimer();

            // 游戏结束，所有按钮移除点击事件
            for (let r = 1; r <= this.gameArea.rows - 2; r++) {
                for (let c = 1; c <= this.gameArea.cols - 2; c++) {
                    let block = this.gameArea.blockArray[r][c];
                    block.button.removeEventListener('click', block.clickEventListener);
                    block.button.removeEventListener('mousedown', block.rightClickEventListener);
                    block.button.removeEventListener('mouseup', block.leftRightClickEventListener);
                }
            }

            // 若赢了游戏，并且本局不是点击了“重新开始本局”所开始的一局，则记录游戏时长、游戏结束时间
            if (win && !this.gameArea.restartGame) {
                insertRecord(GameArea.level, +new Date(), gameTime / 1000);
            }

            // 显示模态框
            const alertBox = Render.gameOverModal.querySelector('.modal-body .alert');
            if (win) {
                alertBox.className = 'alert alert-success';
                alertBox.innerHTML = '你赢了';
            } else {
                alertBox.className = 'alert alert-danger';
                alertBox.innerHTML = '你踩雷了！游戏结束！';
            }
            $(Render.gameOverModal).modal('show');
        }

        static restart () {
            // 如果游戏并未开始过，则开始新游戏
            if (Block.gameArea.firstOpen) {
                Render.startNewGameButton.click();
                return;
            }

            // 清空方块的HTML
            Render.blockArea.innerHTML = '';

            // 记录旧的数字数组
            const oldArray = [];
            for (let r = 0; r < Block.gameArea.rows; r++) {
                let ls = [];
                for (let c = 0; c < Block.gameArea.cols; c++) {
                    ls.push(Block.gameArea.blockArray[r][c].num);
                }
                oldArray.push(ls);
            }

            // 生成新游戏区域和新的渲染实例
            const newGameArea = new GameArea(Block.gameArea.rows, Block.gameArea.cols, Block.gameArea.mineCount);
            const newRender = new Render(newGameArea);
            newGameArea.restartGame = true;

            // 手动初始化雷和数字的分布
            newGameArea.firstOpen = false;
            for (let r = 0; r < oldArray.length; r++) {
                for (let c = 0; c < oldArray[0].length; c++) {
                    newGameArea.blockArray[r][c].num = oldArray[r][c];
                }
            }

            // 渲染游戏区域
            newRender.initGame();
        }

        static startNewGame (level) {
            if (level === undefined) level = GameArea.level;
            const gameInfo = GameArea.levelMapping[level];
            const gameArea = new GameArea(gameInfo.rows, gameInfo.cols, gameInfo.mineCount);
            const render = new Render(gameArea);
            Render.blockArea.innerHTML = '';
            render.initGame();
        }

        static showRankList () {
            // 从indexDB中获取排行榜数据
            readRecord(function (result) {
                // 清除原排名内容
                Render.rankTbodyArray.forEach((tbody) => {
                    tbody.innerHTML = '';
                });

                // 将数据按级别进行分组
                const rankData = [[], [], []];
                result.forEach((record) => {
                    const level = record['level'];
                    rankData[level].push(record);
                });

                // 对数据按游戏用时进行排序，并渲染到模态框的表格中
                rankData.forEach((levelRankArray, level) => {
                    levelRankArray.sort(function (v1, v2) {
                        return v1['gameTime'] - v2['gameTime'];
                    });

                    const tbodyHTML = [];
                    levelRankArray.forEach((record, i) => {
                        const date = (new Date(record['insertTime'])).toLocaleString().replace(/\//g, '-');
                        tbodyHTML.push(
                            '<tr><td>{{ i }}</td><td>{{ gameTime }}</td><td>{{ insertTime }}</td></tr>'
                                .replace('{{ i }}', String(i + 1))
                                .replace('{{ gameTime }}', record['gameTime'])
                                .replace('{{ insertTime }}', date)
                        );
                    });

                    document.querySelector('#rank-list table[data-level="' + level + '"] > tbody').innerHTML = tbodyHTML.join('');
                });

                // 显示模态框
                $(Render.rankListModal).modal('show');
            });
        }

        static startTimer () {
            Render.gameTime.gameStartTime = +new Date();
            Render.gameTime.timer = setInterval(function () {
                Render.gameTime.gameTime = Render.gameTime.gameTime + 1;
                const t = Render.gameTime.gameTime;
                let hours = parseInt(t / 3600);
                let minutes = parseInt((t % 3600) / 60);
                let seconds = t % 60;
                if (hours < 10) {
                    hours = '0' + String(hours);
                }
                if (minutes < 10) {
                    minutes = '0' + String(minutes);
                }
                if (seconds < 10) {
                    seconds = '0' + String(seconds);
                }
                Render.gameTime.innerHTML = [hours, minutes, seconds].join(':');
            }, 1000);
        }

        static stopTimer () {
            Render.gameTime.gameEndTime = +new Date();
            clearInterval(Render.gameTime.timer);
            Render.gameTime.gameTime = 0;
            return Render.gameTime.gameEndTime - Render.gameTime.gameStartTime;
        }
    }

    function generate2DArray (rows, cols, defaultValue) {
        defaultValue = defaultValue || 0;
        const array = [];
        for (let r = 0; r < rows; r++) {
            let ls = [];
            for (let c = 0; c < cols; c++) {
                ls.push(defaultValue);
            }
            array.push(ls);
        }
        return array;
    }

    function generateBlockArray (rows, cols, defaultValue) {
        defaultValue = defaultValue || 0;
        const blockArray = [];
        for (let r = 0; r < rows; r++) {
            let ls = [];
            for (let c = 0; c < cols; c++) {
                ls.push(new Block(r, c, defaultValue));
            }
            blockArray.push(ls);
        }
        return blockArray;
    }

    function print2DArray (array) {
        const ls = [];
        for (let r = 0; r < array.length; r++) {
            for (let c = 0; c < array[0].length; c++) {
                ls.push(array[r][c]);
                ls.push(',\t');
            }
            ls.push('\n');
        }
        console.log(ls.join(''));
    }

    function printBlockArray (blockArray) {
        const ls = [];
        for (let r = 0; r < blockArray.length; r++) {
            for (let c = 0; c < blockArray[0].length; c++) {
                ls.push(blockArray[r][c].num);
                ls.push(',\t');
            }
            ls.push('\n');
        }
        console.log(ls.join(''));
    }

    function getRandomInt (min, max) {
        // 返回[min, max)范围的随机整数
        // min = Math.ceil(min);
        // max = Math.floor(max);
        // if (min > max) {
        //     const t = max;
        //     max = min;
        //     min = t;
        // }
        return Math.floor(Math.random() * (max - min)) + min;
    }

    function generateRangeArray (min, max) {
        // 生成范围在[min, max)的整数构成的一维数组
        const array = [];
        while (min < max) {
            array.push(min);
            min = min + 1;
        }
        return array;
    }

    function choiceRange (min, max, count) {
        // 从[min, max)范围的整数组成的一维数组中选择count个不重复的值
        const indexArray = generateRangeArray(min, max);
        const resultArray = [];
        for (let i = 0; i < count; i++) {
            randomIndex = getRandomInt(0, indexArray.length);
            resultArray.push(indexArray[randomIndex]);
            indexArray.splice(randomIndex, 1);
        }
        return resultArray;
    }

    function choiceValue (array, count) {
        // 从一维数组中随机取出count个不重复索引的元素，返回一维数组
        const indexArray = generateRangeArray(0, array.length);
        const resultArray = [];
        for (let i = 0; i < count; i++) {
            let randomIndex = getRandomInt(0, indexArray.length);
            resultArray.push(array[indexArray[randomIndex]]);
            indexArray.splice(randomIndex, 1);
        }
        return resultArray;
    }

    function valueInArray (array, value) {
        // 检查值是否在一维数组中
        for (let i = 0; i < array.length; i++) {
            if (array[i] === value) {
                return true;
            }
        }
        return false;
    }

    function main () {
        // 禁用鼠标右键菜单
        document.addEventListener('contextmenu', function (event) {
            event.preventDefault();
        });

        // 注册操作按钮组的按钮事件
        Render.restartButton.addEventListener('click', Render.restart);
        Render.startNewGameButton.addEventListener('click', function (e) {
            Render.startNewGame();
        });
        for (let i = 0; i < Render.levelButtonArray.length; i++) {
            Render.levelButtonArray[i].addEventListener('click', function (e) {
                GameArea.level = parseInt(this.getAttribute('data-level'));
                Render.startNewGameButton.click();
            });
        }

        // 开始初级难度
        Render.startNewGameButton.click();

        // 窗口宽度改变时，按钮大小也会发生改变，mainBox宽度也会发生改变
        window.addEventListener('resize', Render.setMainBoxSize);

        // 小屏幕尺寸下的下拉菜单点击事件
        document.querySelector('#action-btn-group .menu').addEventListener('click', function (e) {
            if (this.unfold) {
                document.querySelector('#action-btn-group > .btn-group').classList.remove('show');
            } else {
                document.querySelector('#action-btn-group > .btn-group').classList.add('show');
            }
            this.unfold = !this.unfold;
        });

        // 按钮组点击事件
        document.querySelector('#action-btn-group > .btn-group').addEventListener('click', function (e) {
            if (window.innerWidth > 454) return;
            if (e.target.getAttribute('data-toggle') === 'dropdown') return;
            this.classList.remove('show');
            document.querySelector('#action-btn-group .menu').unfold = false;
        });

        // 切换浅深色主题按钮
        document.getElementById('theme-switch').addEventListener('click', function (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            if (this.getAttribute('data-theme') === 'light') {
                this.setAttribute('data-theme', 'dark');
                link.href = 'css/dark-theme.css'; 
                document.querySelector('link[href$="light-theme.css"]').remove();
            } else {
                this.setAttribute('data-theme', 'light');
                link.href = 'css/light-theme.css';
                document.querySelector('link[href$="dark-theme.css"]').remove();
            }
            document.head.appendChild(link);
        });

        // 动画效果开关按钮
        document.getElementById('animation-switch').addEventListener('click', function (e) {
            if (this.getAttribute('data-open') === '1') {
                this.setAttribute('data-open', '0');
                document.getElementById('block-area').setAttribute('data-animation', '0');
            } else {
                this.setAttribute('data-open', '1');
                document.getElementById('block-area').setAttribute('data-animation', '1');
            }
        });

        // 显示排行榜的按钮
        document.getElementById('show-rank-list').addEventListener('click', Render.showRankList);
    }

    main();
})(window, document);
