Mix Atlas - Python同梱 Windows版

フォルダー全体を、書き込み可能な場所に配置してMixAtlas.exeを起動してください。
Python・uv・Node.jsのインストールやSetupの実行は不要です。

resources/pythonに公式CPython 3.13.3と固定バージョンの解析ライブラリを同梱しています。
CUDA版PyTorchを含むビルドではCPUとNVIDIA GPUを選択できます。
NVIDIA GPUの利用には、そのPCに対応するドライバーが必要です。

音源分離モデルは初回分離時にダウンロードします。モデル取得後の解析はローカルで、
音源を外部へ送信しません。モデル・解析履歴はresources/app/.dataに保存します。
配布元PCの音源・解析履歴・モデルは含めません。合成デモだけを同梱します。

EXE単体では動きません。resourcesやDLLを含むフォルダー全体を保持してください。
Program Filesのような書き込み制限のある場所は避けてください。
Pythonのライセンスはresources/python/LICENSE.txt、依存パッケージのライセンスは
resources/python/Lib/site-packages内の各パッケージとdist-infoに同梱しています。
ElectronのLICENSEとLICENSES.chromium.htmlも保持してください。

同梱バージョンはbuild-info.jsonとresources/python/runtime-manifest.jsonに記録します。
更新は新しい配布フォルダーへ切り替えてください。システムのPythonは変更しません。
